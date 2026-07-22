import type { PrismaClient } from "@prisma/client";
import { expireOverdueInvoices } from "../services/invoiceVerificationService.js";

const TIMEOUT_JOB_ACTOR = "system:invoice-timeout-job";

/**
 * Auto-rejects invoices whose buyer-acknowledgement window has lapsed.
 * expireOverdueInvoices already isolates per-invoice failures, so a single
 * bad row doesn't stop the batch.
 */
export async function runInvoiceTimeoutTick(prisma: PrismaClient): Promise<void> {
  try {
    await expireOverdueInvoices(prisma, TIMEOUT_JOB_ACTOR);
  } catch (err) {
    console.error("Invoice verification timeout tick failed:", err);
  }
}
