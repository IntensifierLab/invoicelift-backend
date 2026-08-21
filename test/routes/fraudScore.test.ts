import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { facilityDeps } from "../../src/lib/facilityDeps.js";
import { buildServer } from "../../src/server.js";
import { resetDb } from "../dbHelpers.js";

const BUYER = "GBUYERFRAUD00000000000000000000000000000000000000000000000";
const SME = "GSMEFRAUD0000000000000000000000000000000000000000000000000";

describe("fraud score route", () => {
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

  it("returns a fraud score for an existing invoice", async () => {
    const invoice = await prisma.invoice.create({
      data: {
        reference: "INV-FRAUD-HTTP-1",
        smeAddress: SME,
        buyerAddress: BUYER,
        amount: 20_000,
        dueDate: new Date("2026-06-01T00:00:00.000Z"),
        invoiceHash: "hash-fraud-http-1",
      },
    });

    const res = await app.inject({
      method: "GET",
      url: `/api/v1/risk/invoices/${invoice.id}/fraud-score`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.invoiceId).toBe(invoice.id);
    expect(typeof body.score).toBe("number");
    expect(["low", "medium", "high"]).toContain(body.riskLevel);
    expect(Array.isArray(body.signals)).toBe(true);
    expect(body.signals.map((s: { code: string }) => s.code)).toContain("ROUND_AMOUNT");
  });

  it("returns 404 for an unknown invoice id", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/risk/invoices/does-not-exist/fraud-score",
    });

    expect(res.statusCode).toBe(404);
  });
});
