import type { Invoice } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { resolveInvoiceConflict } from "../../src/lib/accounting/conflictResolution.js";
import type { ExternalReceivable } from "../../src/lib/accounting/types.js";

function makeInvoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: "inv_1",
    reference: "xero:INV-1",
    smeAddress: "GSME",
    buyerAddress: "GBUYER",
    poolId: null,
    amount: 1_000,
    currency: "USD",
    dueDate: new Date("2026-08-01"),
    invoiceHash: "hash",
    status: "PENDING_SME_SIGNATURE",
    smeSignature: null,
    smeSignedAt: null,
    buyerSignature: null,
    buyerSignedAt: null,
    verificationDeadline: null,
    rejectionReason: null,
    verifiedAt: null,
    createdAt: new Date("2026-07-01"),
    updatedAt: new Date("2026-07-01"),
    ...overrides,
  };
}

function makeReceivable(overrides: Partial<ExternalReceivable> = {}): ExternalReceivable {
  return {
    externalId: "INV-1",
    smeAddress: "GSME",
    buyerAddress: "GBUYER",
    amount: 1_000,
    currency: "USD",
    dueDate: "2026-08-01",
    paid: false,
    ...overrides,
  };
}

describe("resolveInvoiceConflict", () => {
  it("creates when there is no existing invoice", () => {
    expect(resolveInvoiceConflict(null, makeReceivable()).action).toBe("create");
  });

  it("skips when fields already match, regardless of status", () => {
    expect(resolveInvoiceConflict(makeInvoice(), makeReceivable()).action).toBe("skip");
    expect(
      resolveInvoiceConflict(makeInvoice({ status: "VERIFIED" }), makeReceivable()).action,
    ).toBe("skip");
  });

  it("updates a still-unsigned invoice when core fields differ", () => {
    const result = resolveInvoiceConflict(
      makeInvoice({ status: "PENDING_SME_SIGNATURE" }),
      makeReceivable({ amount: 2_000 }),
    );
    expect(result.action).toBe("update");
  });

  it("flags for review rather than overwriting once the SME has signed", () => {
    const result = resolveInvoiceConflict(
      makeInvoice({ status: "PENDING_BUYER_SIGNATURE" }),
      makeReceivable({ amount: 2_000 }),
    );
    expect(result.action).toBe("flag_for_review");
  });

  it("flags for review rather than overwriting a verified invoice", () => {
    const result = resolveInvoiceConflict(
      makeInvoice({ status: "VERIFIED" }),
      makeReceivable({ currency: "EUR" }),
    );
    expect(result.action).toBe("flag_for_review");
  });

  it("treats a due-date mismatch at the day level, ignoring time-of-day", () => {
    const result = resolveInvoiceConflict(
      makeInvoice({ dueDate: new Date("2026-08-01T00:00:00Z") }),
      makeReceivable({ dueDate: "2026-08-01T23:59:59Z" }),
    );
    expect(result.action).toBe("skip");
  });
});
