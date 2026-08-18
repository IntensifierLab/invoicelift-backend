import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { facilityDeps } from "../../lib/facilityDeps.js";
import { PartnerNotFoundError, registerPartner, revokePartner } from "../../services/partnerService.js";

const registerPartnerSchema = z.object({
  name: z.string().min(1),
  contactEmail: z.string().email(),
});

export const partnerRoutes: FastifyPluginAsync = async (app) => {
  app.post("/partners", async (req, reply) => {
    const parsed = registerPartnerSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    const { partner, apiKey } = await registerPartner(facilityDeps.prisma, parsed.data);
    return reply.status(201).send({
      partner,
      apiKey,
      warning: "Store this key now — it will not be shown again.",
    });
  });

  app.post("/partners/:id/revoke", async (req, reply) => {
    const { id } = req.params as { id: string };

    try {
      const partner = await revokePartner(facilityDeps.prisma, id);
      return reply.status(200).send(partner);
    } catch (err) {
      if (err instanceof PartnerNotFoundError) {
        return reply.status(404).send({ error: err.message });
      }
      throw err;
    }
  });
};
