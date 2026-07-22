import { AuditAction } from "@prisma/client";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { facilityDeps } from "../../lib/facilityDeps.js";

const listQuerySchema = z.object({
  treatyId: z.string().optional(),
  drawdownId: z.string().optional(),
  action: z.nativeEnum(AuditAction).optional(),
  limit: z.coerce.number().int().positive().max(200).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});

export const auditRoutes: FastifyPluginAsync = async (app) => {
  app.get("/audit", async (req, reply) => {
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }
    const { treatyId, drawdownId, action, limit, offset } = parsed.data;

    return facilityDeps.prisma.facilityAuditEntry.findMany({
      where: { treatyId, drawdownId, action },
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
    });
  });
};
