import type { FastifyPluginAsync } from "fastify";

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get("/health", async () => ({
    status: "ok",
    service: "api",
    timestamp: new Date().toISOString(),
  }));
};

// Contribution check by lisap at 2024-11-15T02:53:47

// Contribution check by karen-s at 2025-02-19T08:24:49

// Contribution check by alexdev99 at 2025-05-26T13:55:51

// Contribution check by lisap at 2025-08-30T19:26:53

// Contribution check by karen-s at 2025-12-05T00:57:55

// Contribution check by alexdev99 at 2026-03-11T06:28:57

// Contribution check by lisap at 2026-06-15T11:59:59

// Contribution by WIAG1949 — 2024-11-26

// Contribution by kulayddon — 2025-01-18
