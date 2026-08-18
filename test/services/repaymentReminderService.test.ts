import type { Invoice } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";
import { facilityDeps } from "../../src/lib/facilityDeps.js";
import type { MailMessage, MailSendResult, MailTransport } from "../../src/lib/mailer.js";
import {
  findInvoicesDueForReminder,
  sendRepaymentReminders,
} from "../../src/services/repaymentReminderService.js";
import { resetDb } from "../dbHelpers.js";

class FakeMailTransport implements MailTransport {
  sent: MailMessage[] = [];

  async send(message: MailMessage): Promise<MailSendResult> {
    this.sent.push(message);
    return { providerMessageId: `fake_${this.sent.length}` };
  }
}

const prisma = facilityDeps.prisma;
const NOW = new Date("2026-08-18T00:00:00.000Z");

async function createInvoice(overrides: Partial<Invoice> = {}): Promise<Invoice> {
  return prisma.invoice.create({
    data: {
      reference: `INV-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      smeAddress: "GSME000000000000000000000000000000000000000000000000",
      buyerAddress: "GBUYER00000000000000000000000000000000000000000000000",
      amount: 1000,
      status: "VERIFIED",
      dueDate: NOW,
      invoiceHash: "deadbeef",
      ...overrides,
    },
  });
}

describe("findInvoicesDueForReminder", () => {
  beforeEach(async () => {
    await resetDb(prisma);
  });

  it("includes a VERIFIED invoice due within the window", async () => {
    const dueDate = new Date(NOW);
    dueDate.setDate(dueDate.getDate() + 2);
    const invoice = await createInvoice({ dueDate });

    const due = await findInvoicesDueForReminder(prisma, 3, NOW);

    expect(due.map((i) => i.id)).toContain(invoice.id);
  });

  it("excludes an invoice due further out than the window", async () => {
    const dueDate = new Date(NOW);
    dueDate.setDate(dueDate.getDate() + 10);
    await createInvoice({ dueDate });

    const due = await findInvoicesDueForReminder(prisma, 3, NOW);

    expect(due).toHaveLength(0);
  });

  it("excludes an invoice that is already overdue", async () => {
    const dueDate = new Date(NOW);
    dueDate.setDate(dueDate.getDate() - 1);
    await createInvoice({ dueDate });

    const due = await findInvoicesDueForReminder(prisma, 3, NOW);

    expect(due).toHaveLength(0);
  });

  it("excludes a non-VERIFIED invoice even if its dueDate is in the window", async () => {
    const dueDate = new Date(NOW);
    dueDate.setDate(dueDate.getDate() + 1);
    await createInvoice({ dueDate, status: "PENDING_BUYER_SIGNATURE" });

    const due = await findInvoicesDueForReminder(prisma, 3, NOW);

    expect(due).toHaveLength(0);
  });
});

describe("sendRepaymentReminders", () => {
  beforeEach(async () => {
    await resetDb(prisma);
  });

  it("sends one reminder email to the buyer for each due invoice", async () => {
    const dueDate = new Date(NOW);
    dueDate.setDate(dueDate.getDate() + 1);
    const invoice = await createInvoice({ dueDate });
    const mailer = new FakeMailTransport();

    const result = await sendRepaymentReminders(prisma, mailer, 3, NOW);

    expect(result).toEqual({ checked: 1, sent: 1 });
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0].to).toBe(invoice.buyerAddress);
  });

  it("does not send a second reminder to the same buyer on the same day", async () => {
    const dueDate = new Date(NOW);
    dueDate.setDate(dueDate.getDate() + 1);
    await createInvoice({ dueDate });
    const mailer = new FakeMailTransport();

    await sendRepaymentReminders(prisma, mailer, 3, NOW);
    const later = new Date(NOW);
    later.setHours(later.getHours() + 2);
    const second = await sendRepaymentReminders(prisma, mailer, 3, later);

    expect(second.sent).toBe(0);
    expect(mailer.sent).toHaveLength(1);
  });

  it("sends again the following day", async () => {
    const dueDate = new Date(NOW);
    dueDate.setDate(dueDate.getDate() + 2);
    await createInvoice({ dueDate });
    const mailer = new FakeMailTransport();

    await sendRepaymentReminders(prisma, mailer, 3, NOW);
    const nextDay = new Date(NOW);
    nextDay.setDate(nextDay.getDate() + 1);
    const second = await sendRepaymentReminders(prisma, mailer, 3, nextDay);

    expect(second.sent).toBe(1);
    expect(mailer.sent).toHaveLength(2);
  });

  it("reminds each buyer independently when multiple invoices are due", async () => {
    const dueDate = new Date(NOW);
    dueDate.setDate(dueDate.getDate() + 1);
    await createInvoice({ dueDate });
    await createInvoice({
      dueDate,
      buyerAddress: "GBUYER20000000000000000000000000000000000000000000000",
    });
    const mailer = new FakeMailTransport();

    const result = await sendRepaymentReminders(prisma, mailer, 3, NOW);

    expect(result).toEqual({ checked: 2, sent: 2 });
    expect(mailer.sent.map((m) => m.to).sort()).toEqual(
      [
        "GBUYER00000000000000000000000000000000000000000000000",
        "GBUYER20000000000000000000000000000000000000000000000",
      ].sort(),
    );
  });
});
