import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { facilityDeps } from "../../src/lib/facilityDeps.js";
import { buildServer } from "../../src/server.js";
import { resetDb } from "../dbHelpers.js";

describe("reconciliation routes", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildServer();
  });

  beforeEach(async () => {
    await resetDb(facilityDeps.prisma);
  });

  afterAll(async () => {
    await app.close();
  });

  it("triggers a reconciliation run on demand and fetches it as latest", async () => {
    const triggerRes = await app.inject({ method: "POST", url: "/api/v1/reconciliation/trigger" });
    expect(triggerRes.statusCode).toBe(201);
    expect(triggerRes.json()).toHaveProperty("healthy");

    const latestRes = await app.inject({ method: "GET", url: "/api/v1/reconciliation/latest" });
    expect(latestRes.statusCode).toBe(200);
    expect(latestRes.json().id).toBe(triggerRes.json().id);
  });

  it("lists reconciliation runs", async () => {
    await app.inject({ method: "POST", url: "/api/v1/reconciliation/trigger" });
    const listRes = await app.inject({ method: "GET", url: "/api/v1/reconciliation/runs" });
    expect(listRes.statusCode).toBe(200);
    expect(listRes.json().length).toBeGreaterThan(0);
  });

  it("returns 404 for latest when no runs exist", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/reconciliation/latest" });
    expect(res.statusCode).toBe(404);
  });
});
