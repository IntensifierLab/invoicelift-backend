import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { config } from "./config/env.js";
import { startFacilityMonitor, startInvoiceTimeoutMonitor } from "./jobs/index.js";
import { facilityDeps } from "./lib/facilityDeps.js";
import { healthRoutes } from "./routes/health.js";
import { v1Routes } from "./routes/v1/index.js";

export async function buildServer() {
  const app = Fastify({ logger: true });

  await app.register(cors, {
    origin: config.corsOrigin,
  });

  // IP-based rate limiting on public endpoints: 100 req/min per IP by
  // default (configurable via RATE_LIMIT_MAX / RATE_LIMIT_WINDOW_MS). Replies
  // 429 with a Retry-After header once exceeded.
  await app.register(rateLimit, {
    max: config.rateLimitMax,
    timeWindow: config.rateLimitWindowMs,
  });

  await app.register(healthRoutes);
  await app.register(v1Routes, { prefix: config.apiPrefix });

  const monitor = config.enableFacilityMonitor ? startFacilityMonitor(facilityDeps) : null;
  const invoiceTimeoutMonitor = config.enableInvoiceTimeoutMonitor
    ? startInvoiceTimeoutMonitor(facilityDeps.prisma)
    : null;

  app.addHook("onClose", async () => {
    monitor?.stop();
    invoiceTimeoutMonitor?.stop();
    await facilityDeps.prisma.$disconnect();
  });

  return app;
}
