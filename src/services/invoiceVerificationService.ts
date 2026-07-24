import type { Invoice, InvoiceStatus, PrismaClient } from "@prisma/client";
import { config } from "../config/env.js";
import { recordInvoiceAudit } from "../lib/invoiceAudit.js";
import { computeInvoiceHashHex } from "../lib/invoiceHash.js";
import { verifyInvoiceSignature } from "../lib/stellarSignature.js";

export class InvoiceStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvoiceStateError";
  }
}

export interface CreateInvoiceInput {
  reference: string;
  smeAddress: string;
  buyerAddress: string;
  amount: number;
  currency?: string;
  dueDate: Date;
}

export interface SignatureResult {
  invoice: Invoice;
  signatureAccepted: boolean;
}

export async function createInvoice(
  prisma: PrismaClient,
  input: CreateInvoiceInput,
  actor: string,
): Promise<Invoice> {
  const currency = input.currency ?? "USD";
  const invoiceHash = computeInvoiceHashHex({
    reference: input.reference,
    smeAddress: input.smeAddress,
    buyerAddress: input.buyerAddress,
    amount: input.amount,
    currency,
    dueDate: input.dueDate.toISOString(),
  });

  const invoice = await prisma.invoice.create({
    data: {
      reference: input.reference,
      smeAddress: input.smeAddress,
      buyerAddress: input.buyerAddress,
      amount: input.amount,
      currency,
      dueDate: input.dueDate,
      invoiceHash,
    },
  });

  await recordInvoiceAudit(prisma, {
    action: "INVOICE_CREATED",
    actor,
    invoiceId: invoice.id,
    detail: {
      reference: input.reference,
      smeAddress: input.smeAddress,
      buyerAddress: input.buyerAddress,
      amount: input.amount,
      currency,
      dueDate: input.dueDate.toISOString(),
      invoiceHash,
    },
  });

  return invoice;
}

export async function submitSmeSignature(
  prisma: PrismaClient,
  id: string,
  signature: string,
  actor: string,
): Promise<SignatureResult> {
  const invoice = await requireInvoice(prisma, id);

  if (invoice.status !== "PENDING_SME_SIGNATURE") {
    throw new InvoiceStateError(
      `Cannot submit SME signature for invoice in ${invoice.status} status`,
    );
  }

  const verified = verifyInvoiceSignature(invoice.smeAddress, invoice.invoiceHash, signature);

  if (!verified) {
    await recordInvoiceAudit(prisma, {
      action: "SME_SIGNATURE_REJECTED",
      actor,
      invoiceId: invoice.id,
      detail: { signature },
    });
    return { invoice, signatureAccepted: false };
  }

  const now = new Date();
  const verificationDeadline = addDays(now, config.invoiceVerificationTimeoutDays);

  const updated = await prisma.invoice.update({
    where: { id },
    data: {
      smeSignature: signature,
      smeSignedAt: now,
      status: "PENDING_BUYER_SIGNATURE",
      verificationDeadline,
    },
  });

  await recordInvoiceAudit(prisma, {
    action: "SME_SIGNATURE_VERIFIED",
    actor,
    invoiceId: invoice.id,
    detail: { signedAt: now.toISOString(), verificationDeadline: verificationDeadline.toISOString() },
  });

  return { invoice: updated, signatureAccepted: true };
}

export async function submitBuyerSignature(
  prisma: PrismaClient,
  id: string,
  signature: string,
  actor: string,
): Promise<SignatureResult> {
  const invoice = await requireInvoice(prisma, id);

  if (invoice.status !== "PENDING_BUYER_SIGNATURE") {
    throw new InvoiceStateError(
      `Cannot submit buyer signature for invoice in ${invoice.status} status`,
    );
  }

  const now = new Date();

  if (invoice.verificationDeadline && now > invoice.verificationDeadline) {
    const expired = await expireInvoice(prisma, invoice, actor);
    return { invoice: expired, signatureAccepted: false };
  }

  const verified = verifyInvoiceSignature(invoice.buyerAddress, invoice.invoiceHash, signature);

  if (!verified) {
    await recordInvoiceAudit(prisma, {
      action: "BUYER_SIGNATURE_REJECTED",
      actor,
      invoiceId: invoice.id,
      detail: { signature },
    });
    return { invoice, signatureAccepted: false };
  }

  const updated = await prisma.invoice.update({
    where: { id },
    data: {
      buyerSignature: signature,
      buyerSignedAt: now,
      status: "VERIFIED",
      verifiedAt: now,
    },
  });

  await recordInvoiceAudit(prisma, {
    action: "BUYER_SIGNATURE_VERIFIED",
    actor,
    invoiceId: invoice.id,
    detail: { signedAt: now.toISOString() },
  });

  await recordInvoiceAudit(prisma, {
    action: "VERIFICATION_COMPLETED",
    actor,
    invoiceId: invoice.id,
    detail: { verifiedAt: now.toISOString() },
  });

  return { invoice: updated, signatureAccepted: true };
}

export async function getInvoice(prisma: PrismaClient, id: string): Promise<Invoice | null> {
  return prisma.invoice.findUnique({ where: { id } });
}

export async function listInvoices(
  prisma: PrismaClient,
  filter?: { status?: InvoiceStatus },
): Promise<Invoice[]> {
  return prisma.invoice.findMany({ where: filter, orderBy: { createdAt: "desc" } });
}

export async function listInvoiceAuditLog(prisma: PrismaClient, invoiceId: string) {
  return prisma.invoiceAuditEntry.findMany({
    where: { invoiceId },
    orderBy: { createdAt: "asc" },
  });
}

/**
 * Scans for invoices whose buyer-acknowledgement window has lapsed and
 * auto-rejects them. A single invoice's failure does not stop the batch —
 * mirrors the per-treaty error isolation in runMonitorTick.
 */
export async function expireOverdueInvoices(
  prisma: PrismaClient,
  actor: string,
): Promise<Invoice[]> {
  const overdue = await prisma.invoice.findMany({
    where: {
      status: "PENDING_BUYER_SIGNATURE",
      verificationDeadline: { lt: new Date() },
    },
  });

  const expired: Invoice[] = [];

  for (const invoice of overdue) {
    try {
      expired.push(await expireInvoice(prisma, invoice, actor));
    } catch (err) {
      console.error(`Failed to expire invoice ${invoice.id}:`, err);
    }
  }

  return expired;
}

async function expireInvoice(prisma: PrismaClient, invoice: Invoice, actor: string): Promise<Invoice> {
  const updated = await prisma.invoice.update({
    where: { id: invoice.id },
    data: {
      status: "REJECTED",
      rejectionReason: "buyer_acknowledgement_timeout",
    },
  });

  await recordInvoiceAudit(prisma, {
    action: "VERIFICATION_EXPIRED",
    actor,
    invoiceId: invoice.id,
    detail: { verificationDeadline: invoice.verificationDeadline?.toISOString() },
  });

  return updated;
}

async function requireInvoice(prisma: PrismaClient, id: string): Promise<Invoice> {
  const invoice = await prisma.invoice.findUnique({ where: { id } });
  if (!invoice) {
    throw new InvoiceStateError("Invoice not found");
  }
  return invoice;
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}
