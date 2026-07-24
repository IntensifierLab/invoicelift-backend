import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { facilityDeps } from "../../src/lib/facilityDeps.js";
import { buildServer } from "../../src/server.js";
import { resetDb } from "../dbHelpers.js";

const BUYER = "GBUYERHTTP0000000000000000000000000000000000000000000000000";
const SME = "GSMEHTTP00000000000000000000000000000000000000000000000000";

describe("risk analytics routes", () => {
  let app: FastifyInstance;
  const prisma = facilityDeps.prisma;

  beforeAll(async () => {
    app = await buildServer();
  });

  beforeEach(async () => {
    await resetDb(prisma);
  });

  afterAll(async () => {
    await app.close();
  });

  it("returns buyer exposure via HTTP", async () => {
    await prisma.pool.create({ data: { poolId: "pool-http", totalCapital: 5_000, utilisedCapital: 0 } });
    await prisma.invoice.create({
      data: {
        reference: "INV-HTTP-1",
        smeAddress: SME,
        buyerAddress: BUYER,
        poolId: "pool-http",
        amount: 750,
        dueDate: new Date(),
        invoiceHash: "hash-http-1",
        status: "VERIFIED",
      },
    });

    const res = await app.inject({ method: "GET", url: "/api/v1/risk/exposure" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      { buyerAddress: BUYER, totalExposure: 750, byPool: [{ poolId: "pool-http", exposure: 750 }] },
    ]);
  });

  it("returns an empty correlation matrix when there is no exposure yet", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/risk/correlation" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ poolIds: [], matrix: [] });
  });

  it("returns 404 from the contagion simulation for an unknown buyer", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/risk/contagion-simulation",
      payload: { buyerAddress: "unknown" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns 400 for an invalid contagion simulation payload", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/risk/contagion-simulation",
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns the systemic alerts list", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/risk/alerts" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ alerts: [] });
  });
});
