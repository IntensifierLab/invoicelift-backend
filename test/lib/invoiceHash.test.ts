import { describe, expect, it } from "vitest";
import { computeInvoiceHash, computeInvoiceHashHex } from "../../src/lib/invoiceHash.js";

const BASE_INPUT = {
  reference: "INV-1001",
  smeAddress: "GABCSME000000000000000000000000000000000000000000000",
  buyerAddress: "GABCBUYER0000000000000000000000000000000000000000000",
  amount: 5000,
  currency: "USD",
  dueDate: "2026-09-01T00:00:00.000Z",
};

describe("computeInvoiceHash", () => {
  it("is deterministic for identical input", () => {
    const a = computeInvoiceHash(BASE_INPUT);
    const b = computeInvoiceHash(BASE_INPUT);
    expect(a.equals(b)).toBe(true);
  });

  it("produces a 32-byte SHA-256 digest", () => {
    const digest = computeInvoiceHash(BASE_INPUT);
    expect(digest).toHaveLength(32);
  });

  it("changes when the reference changes", () => {
    const a = computeInvoiceHashHex(BASE_INPUT);
    const b = computeInvoiceHashHex({ ...BASE_INPUT, reference: "INV-1002" });
    expect(a).not.toBe(b);
  });

  it("changes when the amount changes", () => {
    const a = computeInvoiceHashHex(BASE_INPUT);
    const b = computeInvoiceHashHex({ ...BASE_INPUT, amount: 5001 });
    expect(a).not.toBe(b);
  });

  it("changes when the SME and buyer addresses are swapped", () => {
    const a = computeInvoiceHashHex(BASE_INPUT);
    const b = computeInvoiceHashHex({
      ...BASE_INPUT,
      smeAddress: BASE_INPUT.buyerAddress,
      buyerAddress: BASE_INPUT.smeAddress,
    });
    expect(a).not.toBe(b);
  });

  it("distinguishes adjacent-field boundary shifts (pipe delimiter matters)", () => {
    // reference and smeAddress are adjacent in the canonical join order.
    // Without a "|" separator, {reference:"AB", smeAddress:"X"} and
    // {reference:"A", smeAddress:"BX"} would concatenate to the same
    // "ABX" and hash identically; the delimiter must keep them distinct.
    const a = computeInvoiceHashHex({ ...BASE_INPUT, reference: "AB", smeAddress: "X" });
    const b = computeInvoiceHashHex({ ...BASE_INPUT, reference: "A", smeAddress: "BX" });
    expect(a).not.toBe(b);
  });
});

describe("computeInvoiceHashHex", () => {
  it("returns the lowercase hex encoding of computeInvoiceHash's digest", () => {
    const hex = computeInvoiceHashHex(BASE_INPUT);
    const digest = computeInvoiceHash(BASE_INPUT);
    expect(hex).toBe(digest.toString("hex"));
    expect(hex).toMatch(/^[0-9a-f]{64}$/);
  });
});
