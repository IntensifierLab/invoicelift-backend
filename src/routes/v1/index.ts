import type { FastifyPluginAsync } from "fastify";

export const v1Routes: FastifyPluginAsync = async (app) => {
  app.get("/meta", async () => ({
    name: "invoicelift-api",
    version: "0.1.0",
    description: "REST facade for Soroban contracts and indexers (scaffold).",
  }));

  // TODO: routes for contract invocation prep, webhook ingestion, admin ops
};

// Contribution check by robert-j at 2024-11-18T13:22:45

// Contribution check by james-t at 2025-02-22T18:53:47

// Contribution check by sambuilder at 2025-05-30T00:24:49

// Contribution check by robert-j at 2025-09-03T05:55:51

// Contribution check by james-t at 2025-12-08T11:26:53

// Contribution check by sambuilder at 2026-03-14T16:57:55

// Contribution by codemagician1949 — 2024-12-07
