import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { facilityDeps } from "../../src/lib/facilityDeps.js";
import { buildServer } from "../../src/server.js";
import { resetDb } from "../dbHelpers.js";

describe("drawdown routes", () => {
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

  it("force-triggers a drawdown for an active treaty on a pool", async () => {
    await facilityDeps.prisma.pool.create({
      data: { poolId: "pool-force", totalCapital: 1000, utilisedCapital: 100 },
    });

    const createRes = await app.inject({
      method: "POST",
      url: "/api/v1/treaties",
      payload: {
        poolId: "pool-force",
        reinsurerName: "Re Force",
        facilityLimit: 100_000,
        triggerThreshold: 0.99,
        costBps: 150,
      },
    });
    const treaty = createRes.json();

    const drawdownRes = await app.inject({
      method: "POST",
      url: "/api/v1/pools/pool-force/drawdown?force=true",
    });

    expect(drawdownRes.statusCode).toBe(200);
    const body = drawdownRes.json();
    expect(body.triggered).toBe(true);
    expect(body.results[0].treatyId).toBe(treaty.id);
    expect(body.results[0].drawdown.status).toBe("CONFIRMED");
  });

  it("returns 404 when no active treaty exists for the pool", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/pools/unknown-pool/drawdown?force=true",
    });
    expect(res.statusCode).toBe(404);
  });
});
