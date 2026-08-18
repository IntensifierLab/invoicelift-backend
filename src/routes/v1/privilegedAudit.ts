import { PrivilegedActionCategory } from "@prisma/client";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { facilityDeps } from "../../lib/facilityDeps.js";
import { listPrivilegedAudit, signAuditExport } from "../../lib/privilegedAudit.js";

const listQuerySchema = z.object({
  actor: z.string().optional(),
  category: z.nativeEnum(PrivilegedActionCategory).optional(),
  action: z.string().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  limit: z.coerce.number().int().positive().max(500).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});

const exportQuerySchema = listQuerySchema.omit({ limit: true, offset: true }).extend({
  limit: z.coerce.number().int().positive().max(5000).default(1000),
});

/** Read + signed-export surface for the general privileged-action audit log. See privilegedAudit.ts for the write path. */
export const privilegedAuditRoutes: FastifyPluginAsync = async (app) => {
  app.get("/audit/privileged", async (req, reply) => {
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }
    return listPrivilegedAudit(facilityDeps.prisma, parsed.data);
  });

  app.get("/audit/privileged/export", async (req, reply) => {
    const parsed = exportQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }
    const entries = await listPrivilegedAudit(facilityDeps.prisma, {
      ...parsed.data,
      offset: 0,
    });
    return signAuditExport(entries);
  });
};
