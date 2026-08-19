import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { facilityDeps } from "../../lib/facilityDeps.js";
import { buildHistogram, runSimulation } from "../../lib/monteCarlo.js";

const runSimulationSchema = z.object({
  poolId: z.string().optional(),
  defaultRate: z.number().gt(0).lt(1),
  correlation: z.number().min(0).lt(1),
  poolSize: z.number().int().positive(),
  feePct: z.number(),
  lossGivenDefault: z.number().min(0).max(1).optional(),
  trials: z.number().int().positive().max(100_000).optional(),
  confidenceLevel: z.number().gt(0).lt(1).optional(),
  seed: z.number().int().optional(),
});

/** Monte Carlo pool-drawdown simulation: run + store, fetch, and a chart-ready visualisation endpoint. */
export const simulationRoutes: FastifyPluginAsync = async (app) => {
  app.post("/simulations", async (req, reply) => {
    const parsed = runSimulationSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    const result = runSimulation(parsed.data);
    const stored = await facilityDeps.prisma.simulationRun.create({
      data: {
        poolId: parsed.data.poolId,
        defaultRate: result.params.defaultRate,
        correlation: result.params.correlation,
        poolSize: result.params.poolSize,
        feePct: result.params.feePct,
        lossGivenDefault: result.params.lossGivenDefault,
        trials: result.params.trials,
        confidenceLevel: result.params.confidenceLevel,
        seed: result.params.seed,
        valueAtRisk: result.valueAtRisk,
        conditionalValueAtRisk: result.conditionalValueAtRisk,
        maxDrawdown: result.maxDrawdown,
        lenderNetReturn: result.lenderNetReturn,
        lossDistribution: result.lossDistribution,
      },
    });

    return reply.status(201).send(stored);
  });

  app.get("/simulations/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const run = await facilityDeps.prisma.simulationRun.findUnique({ where: { id } });
    if (!run) return reply.status(404).send({ error: "simulation not found" });
    return run;
  });

  app.get("/simulations/:id/chart", async (req, reply) => {
    const { id } = req.params as { id: string };
    const run = await facilityDeps.prisma.simulationRun.findUnique({ where: { id } });
    if (!run) return reply.status(404).send({ error: "simulation not found" });

    const lossDistribution = run.lossDistribution as number[];
    return {
      id: run.id,
      valueAtRisk: run.valueAtRisk,
      conditionalValueAtRisk: run.conditionalValueAtRisk,
      maxDrawdown: run.maxDrawdown,
      lenderNetReturn: run.lenderNetReturn,
      histogram: buildHistogram(lossDistribution),
    };
  });
};
