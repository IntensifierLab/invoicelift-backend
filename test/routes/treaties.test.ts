import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { facilityDeps } from "../../src/lib/facilityDeps.js";
import { buildServer } from "../../src/server.js";
import { resetDb } from "../dbHelpers.js";

describe("treaty routes", () => {
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

  it("creates and fetches a treaty via HTTP", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/api/v1/treaties",
      payload: {
        poolId: "pool-http",
        reinsurerName: "Re HTTP",
        facilityLimit: 100_000,
        triggerThreshold: 0.8,
        costBps: 150,
      },
    });

    expect(createRes.statusCode).toBe(201);
    const created = createRes.json();
    expect(created.poolId).toBe("pool-http");

    const getRes = await app.inject({ method: "GET", url: `/api/v1/treaties/${created.id}` });
    expect(getRes.statusCode).toBe(200);
    expect(getRes.json().id).toBe(created.id);
  });

  it("returns 400 for an invalid treaty payload", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/treaties",
      payload: { poolId: "pool-http" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 404 for an unknown treaty id", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/treaties/does-not-exist" });
    expect(res.statusCode).toBe(404);
  });
});
