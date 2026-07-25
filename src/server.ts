import Fastify from "fastify";
import cors from "@fastify/cors";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
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

  await app.register(swagger, {
    openapi: {
      openapi: "3.0.0",
      info: {
        title: "InvoiceLift API",
        description:
          "REST facade for Soroban contracts and indexers. No authentication is currently " +
          "required on any endpoint — every route below is public (see rate limiting for abuse " +
          "protection).",
        version: "0.1.0",
      },
      servers: [{ url: config.apiPrefix, description: "API root" }],
    },
  });
  await app.register(swaggerUi, {
    routePrefix: "/docs",
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
