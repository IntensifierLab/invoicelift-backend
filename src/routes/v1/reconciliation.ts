import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { facilityDeps } from "../../lib/facilityDeps.js";
import { runReconciliationTick } from "../../jobs/ledgerReconciliation.js";

const listQuerySchema = z.object({
  healthy: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().positive().max(200).default(20),
});

/** Visibility into ledger reconciliation runs, plus an on-demand trigger for manual checks. */
export const reconciliationRoutes: FastifyPluginAsync = async (app) => {
  app.get("/reconciliation/runs", async (req, reply) => {
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }
    return facilityDeps.prisma.reconciliationRun.findMany({
      where: parsed.data.healthy === undefined ? undefined : { healthy: parsed.data.healthy },
      orderBy: { ranAt: "desc" },
      take: parsed.data.limit,
    });
  });

  app.get("/reconciliation/latest", async (_req, reply) => {
    const latest = await facilityDeps.prisma.reconciliationRun.findFirst({
      orderBy: { ranAt: "desc" },
    });
    if (!latest) return reply.status(404).send({ error: "no reconciliation runs yet" });
    return latest;
  });

  app.post("/reconciliation/trigger", async (_req, reply) => {
    await runReconciliationTick(facilityDeps.prisma, facilityDeps.onChainClient);
    const latest = await facilityDeps.prisma.reconciliationRun.findFirst({
      orderBy: { ranAt: "desc" },
    });
    return reply.status(201).send(latest);
  });
};
