import { Prisma, TreatyStatus } from "@prisma/client";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { facilityDeps } from "../../lib/facilityDeps.js";
import { createTreaty, getTreaty, listTreaties, updateTreaty } from "../../services/treatyService.js";

const ACTOR = "api:anonymous";

const createTreatySchema = z.object({
  poolId: z.string().min(1),
  reinsurerName: z.string().min(1),
  facilityLimit: z.number().int().positive(),
  triggerThreshold: z.number().min(0).max(1),
  costBps: z.number().int().nonnegative(),
  currency: z.string().min(1).optional(),
});

const updateTreatySchema = z.object({
  reinsurerName: z.string().min(1).optional(),
  facilityLimit: z.number().int().positive().optional(),
  triggerThreshold: z.number().min(0).max(1).optional(),
  costBps: z.number().int().nonnegative().optional(),
  currency: z.string().min(1).optional(),
  status: z.nativeEnum(TreatyStatus).optional(),
});

const listQuerySchema = z.object({
  status: z.nativeEnum(TreatyStatus).optional(),
});

export const treatyRoutes: FastifyPluginAsync = async (app) => {
  app.post("/treaties", async (req, reply) => {
    const parsed = createTreatySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    const treaty = await createTreaty(facilityDeps.prisma, parsed.data, ACTOR);
    return reply.status(201).send(treaty);
  });

  app.get("/treaties", async (req, reply) => {
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    return listTreaties(facilityDeps.prisma, parsed.data);
  });

  app.get("/treaties/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const treaty = await getTreaty(facilityDeps.prisma, id);
    if (!treaty) {
      return reply.status(404).send({ error: "Treaty not found" });
    }
    return treaty;
  });

  app.patch("/treaties/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = updateTreatySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    try {
      return await updateTreaty(facilityDeps.prisma, id, parsed.data, ACTOR);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
        return reply.status(404).send({ error: "Treaty not found" });
      }
      throw err;
    }
  });
};
