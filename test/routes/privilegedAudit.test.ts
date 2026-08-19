import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { facilityDeps } from "../../src/lib/facilityDeps.js";
import { buildServer } from "../../src/server.js";
import { resetDb } from "../dbHelpers.js";

describe("privileged audit routes", () => {
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

  it("logs a privileged audit entry when a treaty is created, then lists it via HTTP", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/api/v1/treaties",
      payload: {
        poolId: "pool-audit",
        reinsurerName: "Re Audit",
        facilityLimit: 50_000,
        triggerThreshold: 0.75,
        costBps: 100,
      },
    });
    expect(createRes.statusCode).toBe(201);

    const listRes = await app.inject({
      method: "GET",
      url: "/api/v1/audit/privileged?category=FACILITY&action=TREATY_CREATED",
    });
    expect(listRes.statusCode).toBe(200);
    const entries = listRes.json();
    expect(entries).toHaveLength(1);
    expect(entries[0].resourceType).toBe("Treaty");
  });

  it("returns a signed export via HTTP", async () => {
    await app.inject({
      method: "POST",
      url: "/api/v1/treaties",
      payload: {
        poolId: "pool-export",
        reinsurerName: "Re Export",
        facilityLimit: 10_000,
        triggerThreshold: 0.5,
        costBps: 50,
      },
    });

    const exportRes = await app.inject({ method: "GET", url: "/api/v1/audit/privileged/export" });
    expect(exportRes.statusCode).toBe(200);
    const body = exportRes.json();
    expect(body).toHaveProperty("signature");
    expect(body).toHaveProperty("signerPublicKey");
    expect(body.entryCount).toBeGreaterThan(0);
  });

  it("returns 400 for an invalid category filter", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/audit/privileged?category=NOT_REAL",
    });
    expect(res.statusCode).toBe(400);
  });
});
