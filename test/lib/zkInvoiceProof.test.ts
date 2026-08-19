import { describe, expect, it } from "vitest";
import {
  computeInvoiceCommitment,
  computeInvoiceNullifier,
  generateCommitmentSalt,
  generateInvoiceUniquenessProof,
  isWellFormedProof,
  type InvoiceIdentityFields,
} from "../../src/lib/zkInvoiceProof.js";

const fields: InvoiceIdentityFields = {
  invoiceReference: "INV-001",
  smeAddress: "SME_ADDR",
  buyerAddress: "BUYER_ADDR",
  amount: 1000,
  dueDate: "2026-12-31T00:00:00.000Z",
};

describe("zkInvoiceProof", () => {
  it("computes a 64-hex-char commitment and nullifier", () => {
    const proof = generateInvoiceUniquenessProof(fields);
    expect(proof.commitment).toMatch(/^[0-9a-f]{64}$/);
    expect(proof.nullifier).toMatch(/^[0-9a-f]{64}$/);
  });

  it("the nullifier is deterministic — identical for the same fields regardless of salt", () => {
    const a = computeInvoiceNullifier(fields);
    const b = computeInvoiceNullifier({ ...fields });
    expect(a).toBe(b);
  });

  it("the commitment differs across salts for the same fields (hiding)", () => {
    const salt1 = generateCommitmentSalt();
    const salt2 = generateCommitmentSalt();
    expect(salt1).not.toBe(salt2);
    const c1 = computeInvoiceCommitment(fields, salt1);
    const c2 = computeInvoiceCommitment(fields, salt2);
    expect(c1).not.toBe(c2);
  });

  it("different invoices produce different nullifiers", () => {
    const a = computeInvoiceNullifier(fields);
    const b = computeInvoiceNullifier({ ...fields, invoiceReference: "INV-002" });
    expect(a).not.toBe(b);
  });

  it("changing any single field changes the nullifier", () => {
    const base = computeInvoiceNullifier(fields);
    expect(computeInvoiceNullifier({ ...fields, amount: 1001 })).not.toBe(base);
    expect(computeInvoiceNullifier({ ...fields, buyerAddress: "OTHER" })).not.toBe(base);
    expect(computeInvoiceNullifier({ ...fields, dueDate: "2027-01-01T00:00:00.000Z" })).not.toBe(
      base,
    );
  });

  describe("isWellFormedProof", () => {
    it("accepts a real generated proof", () => {
      expect(isWellFormedProof(generateInvoiceUniquenessProof(fields))).toBe(true);
    });

    it("rejects malformed shapes", () => {
      expect(isWellFormedProof(null)).toBe(false);
      expect(isWellFormedProof({})).toBe(false);
      expect(isWellFormedProof({ commitment: "not-hex", nullifier: "also-not-hex" })).toBe(false);
      expect(isWellFormedProof({ commitment: "a".repeat(64) })).toBe(false);
    });
  });
});
