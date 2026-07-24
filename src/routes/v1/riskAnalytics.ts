import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { facilityDeps } from "../../lib/facilityDeps.js";
import {
  UnknownBuyerError,
  checkSystemicAlerts,
  getBuyerExposure,
  getPoolCorrelationMatrix,
  simulateDefaultContagion,
} from "../../services/riskAnalyticsService.js";

const contagionSchema = z.object({
  buyerAddress: z.string().min(1),
});

export const riskAnalyticsRoutes: FastifyPluginAsync = async (app) => {
  app.get("/risk/exposure", async () => {
    return getBuyerExposure(facilityDeps.prisma);
  });

  app.get("/risk/correlation", async () => {
    return getPoolCorrelationMatrix(facilityDeps.prisma);
  });

  app.post("/risk/contagion-simulation", async (req, reply) => {
    const parsed = contagionSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    try {
      return await simulateDefaultContagion(facilityDeps.prisma, parsed.data.buyerAddress);
    } catch (err) {
      if (err instanceof UnknownBuyerError) {
        return reply.status(404).send({ error: err.message });
      }
      throw err;
    }
  });

  app.get("/risk/alerts", async () => {
    return { alerts: await checkSystemicAlerts(facilityDeps.prisma) };
  });
};
