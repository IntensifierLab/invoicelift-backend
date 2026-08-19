import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { facilityDeps } from "../../src/lib/facilityDeps.js";
import { buildServer } from "../../src/server.js";
import { resetDb } from "../dbHelpers.js";

describe("regulatory export routes", () => {
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

  it("generates and fetches an export via HTTP", async () => {
    const genRes = await app.inject({
      method: "POST",
      url: "/api/v1/regulatory-exports",
      payload: {
        reportType: "INVOICE_VOLUME",
        format: "JSON",
        periodStart: "2026-01-01",
        periodEnd: "2026-01-31",
      },
    });
    expect(genRes.statusCode).toBe(201);
    const created = genRes.json();

    const getRes = await app.inject({
      method: "GET",
      url: `/api/v1/regulatory-exports/${created.id}`,
    });
    expect(getRes.statusCode).toBe(200);
    expect(getRes.json().id).toBe(created.id);
  });

  it("lists exports, optionally filtered by reportType", async () => {
    await app.inject({
      method: "POST",
      url: "/api/v1/regulatory-exports",
      payload: {
        reportType: "DEFAULT_RATE",
        format: "JSON",
        periodStart: "2026-01-01",
        periodEnd: "2026-01-31",
      },
    });

    const listRes = await app.inject({
      method: "GET",
      url: "/api/v1/regulatory-exports?reportType=DEFAULT_RATE",
    });
    expect(listRes.statusCode).toBe(200);
    const list = listRes.json();
    expect(list.length).toBeGreaterThan(0);
    expect(list.every((r: { reportType: string }) => r.reportType === "DEFAULT_RATE")).toBe(true);
  });

  it("rejects periodEnd before periodStart", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/regulatory-exports",
      payload: {
        reportType: "INVOICE_VOLUME",
        format: "JSON",
        periodStart: "2026-02-01",
        periodEnd: "2026-01-01",
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 404 for an unknown export id", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/regulatory-exports/nope" });
    expect(res.statusCode).toBe(404);
  });
});
