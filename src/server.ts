import Fastify from "fastify";
import cors from "@fastify/cors";
import { config } from "./config/env.js";
import { startFacilityMonitor } from "./jobs/index.js";
import { facilityDeps } from "./lib/facilityDeps.js";
import { healthRoutes } from "./routes/health.js";
import { v1Routes } from "./routes/v1/index.js";

export async function buildServer() {
  const app = Fastify({ logger: true });

  await app.register(cors, {
    origin: config.corsOrigin,
  });

  await app.register(healthRoutes);
  await app.register(v1Routes, { prefix: config.apiPrefix });

  const monitor = config.enableFacilityMonitor ? startFacilityMonitor(facilityDeps) : null;

  app.addHook("onClose", async () => {
    monitor?.stop();
    await facilityDeps.prisma.$disconnect();
  });

  return app;
}
