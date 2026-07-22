import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { facilityDeps } from "../../lib/facilityDeps.js";
import { evaluateAndDraw } from "../../services/drawdownOrchestrator.js";

const ACTOR = "api:anonymous";

const triggerQuerySchema = z.object({
  force: z.enum(["true", "false"]).optional(),
});

export const drawdownRoutes: FastifyPluginAsync = async (app) => {
  app.get("/treaties/:id/drawdowns", async (req) => {
    const { id } = req.params as { id: string };
    return facilityDeps.prisma.capitalDrawdown.findMany({
      where: { treatyId: id },
      orderBy: { requestedAt: "desc" },
    });
  });

  app.get("/drawdowns/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const drawdown = await facilityDeps.prisma.capitalDrawdown.findUnique({ where: { id } });
    if (!drawdown) {
      return reply.status(404).send({ error: "Drawdown not found" });
    }
    return drawdown;
  });

  // Manual trigger — orchestrates the request-capital -> confirm-on-chain
  // flow immediately, without waiting for the periodic monitor tick.
  app.post("/pools/:id/drawdown", async (req, reply) => {
    const { id: poolId } = req.params as { id: string };
    const parsed = triggerQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }
    const force = parsed.data.force === "true";

    const treaties = await facilityDeps.prisma.treaty.findMany({
      where: { poolId, status: "ACTIVE" },
    });
    if (treaties.length === 0) {
      return reply.status(404).send({ error: `No active treaty found for pool ${poolId}` });
    }

    const results = await Promise.all(
      treaties.map(async (treaty) => ({
        treatyId: treaty.id,
        drawdown: await evaluateAndDraw(treaty, facilityDeps, ACTOR, { force }),
      })),
    );

    return {
      triggered: results.some((r) => r.drawdown !== null),
      results,
    };
  });
};
