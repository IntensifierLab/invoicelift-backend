import { PrismaClient } from "@prisma/client";
import { Keypair } from "@stellar/stellar-sdk";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { runInvoiceTimeoutTick } from "../../src/jobs/invoiceVerificationTimeout.js";
import { createInvoice, submitSmeSignature } from "../../src/services/invoiceVerificationService.js";
import { resetDb } from "../dbHelpers.js";

const prisma = new PrismaClient();

describe("runInvoiceTimeoutTick", () => {
  beforeEach(async () => {
    await resetDb(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("rejects only invoices past their verification deadline", async () => {
    const sme = Keypair.random();
    const buyer = Keypair.random();

    const overdue = await createInvoice(
      prisma,
      {
        reference: "job-overdue",
        smeAddress: sme.publicKey(),
        buyerAddress: buyer.publicKey(),
        amount: 1000,
        dueDate: new Date("2026-12-31T00:00:00.000Z"),
      },
      "test:actor",
    );
    await submitSmeSignature(
      prisma,
      overdue.id,
      sme.signMessage(overdue.invoiceHash).toString("base64"),
      "test:actor",
    );
    await prisma.invoice.update({
      where: { id: overdue.id },
      data: { verificationDeadline: new Date(Date.now() - 1000) },
    });

    const notYetDue = await createInvoice(
      prisma,
      {
        reference: "job-not-due",
        smeAddress: sme.publicKey(),
        buyerAddress: buyer.publicKey(),
        amount: 1000,
        dueDate: new Date("2026-12-31T00:00:00.000Z"),
      },
      "test:actor",
    );
    await submitSmeSignature(
      prisma,
      notYetDue.id,
      sme.signMessage(notYetDue.invoiceHash).toString("base64"),
      "test:actor",
    );

    await runInvoiceTimeoutTick(prisma);

    const overdueAfter = await prisma.invoice.findUnique({ where: { id: overdue.id } });
    expect(overdueAfter?.status).toBe("REJECTED");
    expect(overdueAfter?.rejectionReason).toBe("buyer_acknowledgement_timeout");

    const notYetDueAfter = await prisma.invoice.findUnique({ where: { id: notYetDue.id } });
    expect(notYetDueAfter?.status).toBe("PENDING_BUYER_SIGNATURE");
  });
});
