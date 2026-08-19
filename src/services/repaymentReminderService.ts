import type { Invoice, PrismaClient } from "@prisma/client";
import type { MailTransport } from "../lib/mailer.js";
import { sendNotification } from "./notificationService.js";

/**
 * Invoices whose financing is live (VERIFIED) and whose dueDate falls within
 * the reminder window: not yet overdue, but due within `daysBefore` days.
 * Overdue invoices are the delinquency flow's concern, not reminders'.
 */
export async function findInvoicesDueForReminder(
  prisma: PrismaClient,
  daysBefore: number,
  now: Date = new Date(),
): Promise<Invoice[]> {
  const windowEnd = new Date(now);
  windowEnd.setDate(windowEnd.getDate() + daysBefore);

  return prisma.invoice.findMany({
    where: {
      status: "VERIFIED",
      dueDate: { gte: now, lte: windowEnd },
    },
  });
}

/**
 * True if a REPAYMENT_REMINDER email was already logged for this recipient
 * today. Guards against re-sending on every check-interval tick without
 * needing a new column on Invoice (a check-interval that's shorter than a
 * day, or a job restart, would otherwise re-notify the buyer repeatedly for
 * the same due invoice).
 */
async function alreadyRemindedToday(
  prisma: PrismaClient,
  recipient: string,
  now: Date,
): Promise<boolean> {
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);

  const existing = await prisma.emailLog.findFirst({
    where: {
      recipient,
      eventType: "REPAYMENT_REMINDER",
      createdAt: { gte: startOfDay },
    },
  });
  return existing !== null;
}

export interface SendRepaymentRemindersResult {
  checked: number;
  sent: number;
}

/**
 * Sends a REPAYMENT_REMINDER email to the buyer of each invoice due within
 * the reminder window, skipping any buyer already reminded today. A single
 * invoice's failure does not stop the batch.
 */
export async function sendRepaymentReminders(
  prisma: PrismaClient,
  mailer: MailTransport,
  daysBefore: number,
  now: Date = new Date(),
): Promise<SendRepaymentRemindersResult> {
  const dueInvoices = await findInvoicesDueForReminder(prisma, daysBefore, now);
  let sent = 0;

  for (const invoice of dueInvoices) {
    try {
      if (await alreadyRemindedToday(prisma, invoice.buyerAddress, now)) {
        continue;
      }

      await sendNotification(prisma, mailer, {
        recipient: invoice.buyerAddress,
        eventType: "REPAYMENT_REMINDER",
        data: {
          reference: invoice.reference,
          amount: invoice.amount,
          currency: invoice.currency,
          dueDate: invoice.dueDate.toISOString().slice(0, 10),
        },
        now,
      });
      sent++;
    } catch (err) {
      console.error(`Failed to send repayment reminder for invoice ${invoice.id}:`, err);
    }
  }

  return { checked: dueInvoices.length, sent };
}
