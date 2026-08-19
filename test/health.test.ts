import type { FastifyInstance } from "fastify";
import { describe, expect, it, afterAll, beforeAll } from "vitest";
import packageJson from "../package.json" with { type: "json" };
import { checkHealth } from "../src/routes/health.js";
import { buildServer } from "../src/server.js";

describe("GET /health", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildServer();
  });

  afterAll(async () => {
    await app.close();
  });

  it("returns 200 with status, version and uptime when the database is reachable", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("ok");
    expect(body.version).toBe(packageJson.version);
    expect(typeof body.uptime).toBe("number");
    expect(body.uptime).toBeGreaterThanOrEqual(0);
  });

  it("requires no authentication", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).not.toBe(401);
    expect(res.statusCode).not.toBe(403);
  });
});

describe("checkHealth", () => {
  it("reports ok when the dependency ping succeeds", async () => {
    const result = await checkHealth(async () => undefined);
    expect(result.status).toBe("ok");
    expect(result.version).toBe(packageJson.version);
    expect(typeof result.uptime).toBe("number");
  });

  it("reports error when the dependency ping throws", async () => {
    const result = await checkHealth(async () => {
      throw new Error("connection refused");
    });
    expect(result.status).toBe("error");
    expect(result.version).toBe(packageJson.version);
    expect(typeof result.uptime).toBe("number");
  });
});
