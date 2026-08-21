import { beforeEach, describe, expect, it } from "vitest";
import { facilityDeps } from "../../src/lib/facilityDeps.js";
import { InvoiceNotFoundError, computeFraudScore } from "../../src/services/fraudScoringService.js";
import { resetDb } from "../dbHelpers.js";

const prisma = facilityDeps.prisma;

let seq = 0;
function nextAddress(prefix: string): string {
  seq += 1;
  return `G${prefix}${String(seq).padStart(3, "0")}${"0".repeat(50)}`.slice(0, 56);
}

interface InvoiceOverrides {
  smeAddress?: string;
  buyerAddress?: string;
  amount?: number;
  createdAt?: Date;
  dueDate?: Date;
}

async function createTestInvoice(overrides: InvoiceOverrides = {}) {
  const createdAt = overrides.createdAt ?? new Date("2026-01-01T00:00:00.000Z");
  return prisma.invoice.create({
    data: {
      reference: `INV-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      smeAddress: overrides.smeAddress ?? nextAddress("SME"),
      buyerAddress: overrides.buyerAddress ?? nextAddress("BUY"),
      amount: overrides.amount ?? 5000,
      dueDate: overrides.dueDate ?? new Date("2026-03-01T00:00:00.000Z"),
      invoiceHash: "deadbeef",
      createdAt,
    },
  });
}

describe("computeFraudScore", () => {
  beforeEach(async () => {
    await resetDb(prisma);
  });

  it("throws InvoiceNotFoundError for an unknown invoice id", async () => {
    await expect(computeFraudScore(prisma, "does-not-exist")).rejects.toThrow(InvoiceNotFoundError);
  });

  it("scores a routine invoice low with no signals other than new-counterparty", async () => {
    // amount below the round-amount/new-counterparty threshold, due date far
    // in the future — nothing here should read as unusual.
    const invoice = await createTestInvoice({ amount: 4_999 });

    const result = await computeFraudScore(prisma, invoice.id);

    expect(result.invoiceId).toBe(invoice.id);
    expect(result.signals).toHaveLength(0);
    expect(result.score).toBe(0);
    expect(result.riskLevel).toBe("low");
  });

  it("flags a due date within days of creation as RUSH_DUE_DATE", async () => {
    const invoice = await createTestInvoice({
      amount: 1000,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      dueDate: new Date("2026-01-02T00:00:00.000Z"),
    });

    const result = await computeFraudScore(prisma, invoice.id);

    expect(result.signals.map((s) => s.code)).toContain("RUSH_DUE_DATE");
  });

  it("flags an exact-multiple amount as ROUND_AMOUNT", async () => {
    const invoice = await createTestInvoice({ amount: 20_000 });

    const result = await computeFraudScore(prisma, invoice.id);

    expect(result.signals.map((s) => s.code)).toContain("ROUND_AMOUNT");
  });

  it("flags an amount far above the SME's historical average as AMOUNT_OUTLIER", async () => {
    const sme = nextAddress("SME");
    for (let i = 0; i < 3; i++) {
      await createTestInvoice({ smeAddress: sme, amount: 1000 });
    }
    const outlier = await createTestInvoice({ smeAddress: sme, amount: 10_000 });

    const result = await computeFraudScore(prisma, outlier.id);

    expect(result.signals.map((s) => s.code)).toContain("AMOUNT_OUTLIER");
  });

  it("does not flag AMOUNT_OUTLIER when the SME has fewer than 3 prior invoices", async () => {
    const sme = nextAddress("SME");
    await createTestInvoice({ smeAddress: sme, amount: 1000 });
    const invoice = await createTestInvoice({ smeAddress: sme, amount: 1999 });

    const result = await computeFraudScore(prisma, invoice.id);

    expect(result.signals.map((s) => s.code)).not.toContain("AMOUNT_OUTLIER");
  });

  it("flags a large first-time SME/buyer pairing as NEW_COUNTERPARTY_LARGE_AMOUNT", async () => {
    const invoice = await createTestInvoice({ amount: 15_000 });

    const result = await computeFraudScore(prisma, invoice.id);

    expect(result.signals.map((s) => s.code)).toContain("NEW_COUNTERPARTY_LARGE_AMOUNT");
  });

  it("does not flag NEW_COUNTERPARTY_LARGE_AMOUNT for a repeat pairing", async () => {
    const sme = nextAddress("SME");
    const buyer = nextAddress("BUY");
    await createTestInvoice({ smeAddress: sme, buyerAddress: buyer, amount: 15_000 });
    const second = await createTestInvoice({ smeAddress: sme, buyerAddress: buyer, amount: 15_001 });

    const result = await computeFraudScore(prisma, second.id);

    expect(result.signals.map((s) => s.code)).not.toContain("NEW_COUNTERPARTY_LARGE_AMOUNT");
  });

  it("flags 3+ invoices between the same SME and buyer within 24h as HIGH_VELOCITY", async () => {
    const sme = nextAddress("SME");
    const buyer = nextAddress("BUY");
    const base = new Date("2026-01-01T00:00:00.000Z");

    await createTestInvoice({ smeAddress: sme, buyerAddress: buyer, amount: 1000, createdAt: base });
    await createTestInvoice({
      smeAddress: sme,
      buyerAddress: buyer,
      amount: 1000,
      createdAt: new Date(base.getTime() + 3_600_000),
    });
    const third = await createTestInvoice({
      smeAddress: sme,
      buyerAddress: buyer,
      amount: 1000,
      createdAt: new Date(base.getTime() + 7_200_000),
    });

    const result = await computeFraudScore(prisma, third.id);

    expect(result.signals.map((s) => s.code)).toContain("HIGH_VELOCITY");
  });

  it("caps the score at 100 and reaches high risk when multiple signals stack", async () => {
    const sme = nextAddress("SME");
    const buyer = nextAddress("BUY");
    const base = new Date("2026-01-01T00:00:00.000Z");

    for (let i = 0; i < 4; i++) {
      await createTestInvoice({
        smeAddress: sme,
        buyerAddress: buyer,
        amount: 1000,
        createdAt: new Date(base.getTime() + i * 3_600_000),
      });
    }
    // Round, rushed due date, large-relative-to-history, same-day repeat pairing.
    const flagged = await createTestInvoice({
      smeAddress: sme,
      buyerAddress: buyer,
      amount: 50_000,
      createdAt: new Date(base.getTime() + 4 * 3_600_000),
      dueDate: new Date(base.getTime() + 5 * 3_600_000),
    });

    const result = await computeFraudScore(prisma, flagged.id);

    expect(result.signals.length).toBeGreaterThanOrEqual(3);
    expect(result.riskLevel).toBe("high");
    expect(result.score).toBeLessThanOrEqual(100);
  });
});
