import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { healthRoutes } from "../../src/routes/health.js";

describe("GET /health", () => {
  it("returns status, version, and uptime without auth", async () => {
    const app = Fastify();
    await app.register(healthRoutes, {
      checkCriticalDependency: async () => {},
      now: () => 10_500,
      startedAt: 10_000,
      version: "9.8.7",
    });

    const res = await app.inject({ method: "GET", url: "/health" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok", version: "9.8.7", uptime: 0 });
    await app.close();
  });

  it("returns 503 when the critical dependency check fails", async () => {
    const app = Fastify();
    await app.register(healthRoutes, {
      checkCriticalDependency: async () => {
        throw new Error("database unavailable");
      },
      now: () => 14_000,
      startedAt: 10_000,
      version: "9.8.7",
    });

    const res = await app.inject({ method: "GET", url: "/health" });

    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({
      status: "unavailable",
      version: "9.8.7",
      uptime: 4,
      error: "critical dependency unavailable",
    });
    await app.close();
  });
});