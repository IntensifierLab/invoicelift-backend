import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { facilityDeps } from "../../src/lib/facilityDeps.js";
import { buildServer } from "../../src/server.js";
import { resetDb } from "../dbHelpers.js";

describe("simulation routes", () => {
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

  it("runs, stores, and fetches a simulation via HTTP", async () => {
    const runRes = await app.inject({
      method: "POST",
      url: "/api/v1/simulations",
      payload: {
        poolId: "pool-sim",
        defaultRate: 0.05,
        correlation: 0.2,
        poolSize: 100,
        feePct: 0.03,
        trials: 500,
        seed: 1,
      },
    });
    expect(runRes.statusCode).toBe(201);
    const created = runRes.json();
    expect(created).toHaveProperty("valueAtRisk");
    expect(created).toHaveProperty("id");

    const getRes = await app.inject({ method: "GET", url: `/api/v1/simulations/${created.id}` });
    expect(getRes.statusCode).toBe(200);
    expect(getRes.json().id).toBe(created.id);
  });

  it("returns chart-ready histogram data", async () => {
    const runRes = await app.inject({
      method: "POST",
      url: "/api/v1/simulations",
      payload: {
        defaultRate: 0.05,
        correlation: 0.2,
        poolSize: 100,
        feePct: 0.03,
        trials: 500,
        seed: 2,
      },
    });
    const id = runRes.json().id;

    const chartRes = await app.inject({ method: "GET", url: `/api/v1/simulations/${id}/chart` });
    expect(chartRes.statusCode).toBe(200);
    const chart = chartRes.json();
    expect(Array.isArray(chart.histogram)).toBe(true);
    expect(chart.histogram.length).toBeGreaterThan(0);
  });

  it("returns 404 for an unknown simulation id", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/simulations/nonexistent" });
    expect(res.statusCode).toBe(404);
  });

  it("returns 400 for invalid simulation parameters", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/simulations",
      payload: { defaultRate: 2, correlation: 0.2, poolSize: 100, feePct: 0.03 },
    });
    expect(res.statusCode).toBe(400);
  });
});
