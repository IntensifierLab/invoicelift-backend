import { PrismaClient } from "@prisma/client";
import { Keypair } from "@stellar/stellar-sdk";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { computeInvoiceHashHex } from "../../src/lib/invoiceHash.js";
import {
  InvoiceStateError,
  createInvoice,
  expireOverdueInvoices,
  getInvoice,
  submitBuyerSignature,
  submitSmeSignature,
} from "../../src/services/invoiceVerificationService.js";
import { resetDb } from "../dbHelpers.js";

const prisma = new PrismaClient();

async function createTestInvoice(overrides: { reference: string }) {
  const sme = Keypair.random();
  const buyer = Keypair.random();

  const invoice = await createInvoice(
    prisma,
    {
      reference: overrides.reference,
      smeAddress: sme.publicKey(),
      buyerAddress: buyer.publicKey(),
      amount: 5000,
      currency: "USD",
      dueDate: new Date("2026-12-31T00:00:00.000Z"),
    },
    "test:actor",
  );

  return { invoice, sme, buyer };
}

describe("invoiceVerificationService", () => {
  beforeEach(async () => {
    await resetDb(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("computes a deterministic hash at creation time and records INVOICE_CREATED", async () => {
    const { invoice } = await createTestInvoice({ reference: "inv-hash" });

    const expectedHash = computeInvoiceHashHex({
      reference: invoice.reference,
      smeAddress: invoice.smeAddress,
      buyerAddress: invoice.buyerAddress,
      amount: invoice.amount,
      currency: invoice.currency,
      dueDate: invoice.dueDate.toISOString(),
    });

    expect(invoice.invoiceHash).toBe(expectedHash);
    expect(invoice.status).toBe("PENDING_SME_SIGNATURE");

    const entries = await prisma.invoiceAuditEntry.findMany({ where: { invoiceId: invoice.id } });
    expect(entries).toHaveLength(1);
    expect(entries[0].action).toBe("INVOICE_CREATED");
  });

  it("transitions to PENDING_BUYER_SIGNATURE on a valid SME signature", async () => {
    const { invoice, sme } = await createTestInvoice({ reference: "inv-sme-valid" });

    const result = await submitSmeSignature(prisma, invoice.id, signatureFor(sme, invoice.invoiceHash), "test:actor");

    expect(result.signatureAccepted).toBe(true);
    expect(result.invoice.status).toBe("PENDING_BUYER_SIGNATURE");
    expect(result.invoice.verificationDeadline).not.toBeNull();

    const entries = await prisma.invoiceAuditEntry.findMany({
      where: { invoiceId: invoice.id, action: "SME_SIGNATURE_VERIFIED" },
    });
    expect(entries).toHaveLength(1);
  });

  it("leaves the invoice unchanged and audits a rejection on an invalid SME signature", async () => {
    const { invoice } = await createTestInvoice({ reference: "inv-sme-invalid" });
    const wrongKeypair = Keypair.random();

    const result = await submitSmeSignature(
      prisma,
      invoice.id,
      signatureFor(wrongKeypair, invoice.invoiceHash),
      "test:actor",
    );

    expect(result.signatureAccepted).toBe(false);
    expect(result.invoice.status).toBe("PENDING_SME_SIGNATURE");

    const entries = await prisma.invoiceAuditEntry.findMany({
      where: { invoiceId: invoice.id, action: "SME_SIGNATURE_REJECTED" },
    });
    expect(entries).toHaveLength(1);
  });

  it("reaches VERIFIED after a valid SME signature then a valid buyer signature, in order", async () => {
    const { invoice, sme, buyer } = await createTestInvoice({ reference: "inv-full-flow" });

    await submitSmeSignature(prisma, invoice.id, signatureFor(sme, invoice.invoiceHash), "test:actor");
    const result = await submitBuyerSignature(
      prisma,
      invoice.id,
      signatureFor(buyer, invoice.invoiceHash),
      "test:actor",
    );

    expect(result.signatureAccepted).toBe(true);
    expect(result.invoice.status).toBe("VERIFIED");
    expect(result.invoice.verifiedAt).not.toBeNull();

    const entries = await prisma.invoiceAuditEntry.findMany({
      where: { invoiceId: invoice.id },
      orderBy: { createdAt: "asc" },
    });
    expect(entries.map((e) => e.action)).toEqual([
      "INVOICE_CREATED",
      "SME_SIGNATURE_VERIFIED",
      "BUYER_SIGNATURE_VERIFIED",
      "VERIFICATION_COMPLETED",
    ]);
  });

  it("rejects a buyer signature submitted before the SME has signed", async () => {
    const { invoice, buyer } = await createTestInvoice({ reference: "inv-buyer-first" });

    await expect(
      submitBuyerSignature(prisma, invoice.id, signatureFor(buyer, invoice.invoiceHash), "test:actor"),
    ).rejects.toThrow(InvoiceStateError);
  });

  it("auto-rejects an invoice past its verification deadline and leaves others untouched", async () => {
    const { invoice: overdue, sme: overdueSme } = await createTestInvoice({ reference: "inv-overdue" });
    const { invoice: fresh, sme: freshSme } = await createTestInvoice({ reference: "inv-fresh" });

    await submitSmeSignature(prisma, overdue.id, signatureFor(overdueSme, overdue.invoiceHash), "test:actor");
    await submitSmeSignature(prisma, fresh.id, signatureFor(freshSme, fresh.invoiceHash), "test:actor");

    await prisma.invoice.update({
      where: { id: overdue.id },
      data: { verificationDeadline: new Date(Date.now() - 1000) },
    });

    const expired = await expireOverdueInvoices(prisma, "system:test");
    expect(expired.map((i) => i.id)).toEqual([overdue.id]);

    const overdueAfter = await getInvoice(prisma, overdue.id);
    expect(overdueAfter?.status).toBe("REJECTED");
    expect(overdueAfter?.rejectionReason).toBe("buyer_acknowledgement_timeout");

    const freshAfter = await getInvoice(prisma, fresh.id);
    expect(freshAfter?.status).toBe("PENDING_BUYER_SIGNATURE");

    const expiredEntries = await prisma.invoiceAuditEntry.findMany({
      where: { invoiceId: overdue.id, action: "VERIFICATION_EXPIRED" },
    });
    expect(expiredEntries).toHaveLength(1);
  });
});

function signatureFor(keypair: Keypair, message: string): string {
  return keypair.signMessage(message).toString("base64");
}
