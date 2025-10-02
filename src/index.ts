import Fastify from "fastify";
import cors from "@fastify/cors";
import { config } from "./config/env.js";
import { healthRoutes } from "./routes/health.js";
import { v1Routes } from "./routes/v1/index.js";

async function buildServer() {
  const app = Fastify({ logger: true });

  await app.register(cors, {
    origin: config.corsOrigin,
  });

  await app.register(healthRoutes);
  await app.register(v1Routes, { prefix: config.apiPrefix });

  return app;
}

buildServer()
  .then((app) =>
    app.listen({ port: config.port, host: "0.0.0.0" }),
  )
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

// Contribution check by michaelc at 2024-11-11T16:24:49

// Contribution check by william-b at 2025-02-15T21:55:51

// Contribution check by cryptomagician at 2025-05-23T03:26:53

// Contribution check by michaelc at 2025-08-27T08:57:55

// Contribution check by william-b at 2025-12-01T14:28:57

// Contribution check by cryptomagician at 2026-03-07T19:59:59

// Contribution check by michaelc at 2026-06-12T01:31:02

// Contribution by kulayddon — 2024-11-15

// Contribution by CelestinaBeing — 2025-01-08

// Contribution by joelpeace48-cell — 2025-03-02

// Contribution by Williams-1604 — 2025-04-25

// Contribution by codemagician1949 — 2025-06-17

// Contribution by WIAG1949 — 2025-08-09

// Contribution by kulayddon — 2025-10-02
