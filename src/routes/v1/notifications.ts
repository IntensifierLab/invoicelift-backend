import { NotificationEventType } from "@prisma/client";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { renderTemplate } from "../../lib/emailTemplates.js";
import { facilityDeps } from "../../lib/facilityDeps.js";
import { createMailTransport } from "../../lib/mailer.js";
import {
  EmailLogNotFoundError,
  getOrCreatePreference,
  recordBounce,
  sendNotification,
  updatePreference,
} from "../../services/notificationService.js";

const mailer = createMailTransport();

const templateDataSchema = z.record(z.union([z.string(), z.number()])).optional();

const updatePreferenceSchema = z.object({
  invoiceVerified: z.boolean().optional(),
  poolJoined: z.boolean().optional(),
  repaymentReceived: z.boolean().optional(),
  defaultFlagged: z.boolean().optional(),
});

const previewSchema = z.object({
  eventType: z.nativeEnum(NotificationEventType),
  data: templateDataSchema,
});

const sendSchema = z.object({
  recipient: z.string().email(),
  eventType: z.nativeEnum(NotificationEventType),
  data: templateDataSchema,
});

const bounceSchema = z.object({
  providerMessageId: z.string().min(1),
  reason: z.string().optional(),
});

export const notificationRoutes: FastifyPluginAsync = async (app) => {
  app.get("/notifications/preferences/:recipient", async (req) => {
    const { recipient } = req.params as { recipient: string };
    return getOrCreatePreference(facilityDeps.prisma, recipient);
  });

  app.patch("/notifications/preferences/:recipient", async (req, reply) => {
    const { recipient } = req.params as { recipient: string };
    const parsed = updatePreferenceSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }
    return updatePreference(facilityDeps.prisma, recipient, parsed.data);
  });

  // Renders a template without sending or logging anything — for debugging
  // copy/wording without generating EmailLog noise.
  app.post("/notifications/preview", async (req, reply) => {
    const parsed = previewSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }
    return renderTemplate(parsed.data.eventType, parsed.data.data);
  });

  app.post("/notifications/send", async (req, reply) => {
    const parsed = sendSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }
    return sendNotification(facilityDeps.prisma, mailer, parsed.data);
  });

  app.post("/notifications/bounce", async (req, reply) => {
    const parsed = bounceSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    try {
      return await recordBounce(facilityDeps.prisma, parsed.data);
    } catch (err) {
      if (err instanceof EmailLogNotFoundError) {
        return reply.status(404).send({ error: err.message });
      }
      throw err;
    }
  });
};
