import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { facilityDeps } from "../../src/lib/facilityDeps.js";
import { buildServer } from "../../src/server.js";
import { resetDb } from "../dbHelpers.js";

describe("pool routes", () => {
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

  it("creates and fetches a pool via HTTP", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/api/v1/pools",
      payload: { poolId: "pool-http", totalCapital: 5_000 },
    });
    expect(createRes.statusCode).toBe(201);
    expect(createRes.json().poolId).toBe("pool-http");

    const getRes = await app.inject({ method: "GET", url: "/api/v1/pools/pool-http" });
    expect(getRes.statusCode).toBe(200);
    expect(getRes.json().totalCapital).toBe(5_000);
  });

  it("returns 400 when creating a pool outside governance bounds", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/pools",
      payload: { poolId: "too-big", totalCapital: 999_999_999 },
    });
    expect(res.statusCode).toBe(400);
  });

  it("updates a pool's parameters via PATCH", async () => {
    await app.inject({
      method: "POST",
      url: "/api/v1/pools",
      payload: { poolId: "pool-patch", totalCapital: 1_000 },
    });

    const patchRes = await app.inject({
      method: "PATCH",
      url: "/api/v1/pools/pool-patch",
      payload: { totalCapital: 3_000 },
    });
    expect(patchRes.statusCode).toBe(200);
    expect(patchRes.json().totalCapital).toBe(3_000);
  });

  it("returns 404 when patching an unknown pool", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/v1/pools/does-not-exist",
      payload: { totalCapital: 100 },
    });
    expect(res.statusCode).toBe(404);
  });

  it("lists pools", async () => {
    await app.inject({
      method: "POST",
      url: "/api/v1/pools",
      payload: { poolId: "pool-list", totalCapital: 100 },
    });

    const res = await app.inject({ method: "GET", url: "/api/v1/pools" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(1);
  });
});
