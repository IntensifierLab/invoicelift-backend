import type { PrismaClient } from "@prisma/client";
import type { MailTransport } from "../lib/mailer.js";
import { sendRepaymentReminders } from "../services/repaymentReminderService.js";

/**
 * sendRepaymentReminders already isolates per-invoice failures, so a single
 * bad row doesn't stop the batch.
 */
export async function runRepaymentReminderTick(
  prisma: PrismaClient,
  mailer: MailTransport,
  daysBefore: number,
): Promise<void> {
  try {
    await sendRepaymentReminders(prisma, mailer, daysBefore);
  } catch (err) {
    console.error("Repayment reminder tick failed:", err);
  }
}
