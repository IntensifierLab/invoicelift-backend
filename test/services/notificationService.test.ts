import { beforeEach, describe, expect, it } from "vitest";
import { facilityDeps } from "../../src/lib/facilityDeps.js";
import type { MailMessage, MailSendResult, MailTransport } from "../../src/lib/mailer.js";
import {
  EmailLogNotFoundError,
  getOrCreatePreference,
  recordBounce,
  sendNotification,
  updatePreference,
} from "../../src/services/notificationService.js";
import { resetDb } from "../dbHelpers.js";

class FakeMailTransport implements MailTransport {
  sent: MailMessage[] = [];
  nextId = 0;

  async send(message: MailMessage): Promise<MailSendResult> {
    this.sent.push(message);
    this.nextId += 1;
    return { providerMessageId: `fake_${this.nextId}` };
  }
}

class FailingMailTransport implements MailTransport {
  async send(): Promise<MailSendResult> {
    throw new Error("provider down");
  }
}

const prisma = facilityDeps.prisma;

describe("notificationService", () => {
  beforeEach(async () => {
    await resetDb(prisma);
  });

  it("creates a default-enabled preference on first read", async () => {
    const pref = await getOrCreatePreference(prisma, "sme@example.com");
    expect(pref.invoiceVerified).toBe(true);
    expect(pref.poolJoined).toBe(true);
    expect(pref.hasBounced).toBe(false);
  });

  it("sends and logs a notification when the recipient has not opted out", async () => {
    const mailer = new FakeMailTransport();
    const result = await sendNotification(prisma, mailer, {
      recipient: "sme@example.com",
      eventType: "INVOICE_VERIFIED",
      data: { reference: "INV-1" },
    });

    expect(result.status).toBe("SENT");
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0].subject).toContain("INV-1");

    const log = await prisma.emailLog.findUnique({ where: { id: result.emailLogId } });
    expect(log?.status).toBe("SENT");
    expect(log?.providerMessageId).toBeTruthy();
  });

  it("skips sending when the recipient has opted out of that event type", async () => {
    await updatePreference(prisma, "sme@example.com", { invoiceVerified: false });
    const mailer = new FakeMailTransport();

    const result = await sendNotification(prisma, mailer, {
      recipient: "sme@example.com",
      eventType: "INVOICE_VERIFIED",
    });

    expect(result.status).toBe("SKIPPED_PREFERENCE");
    expect(mailer.sent).toHaveLength(0);
  });

  it("records a FAILED log when the transport throws", async () => {
    const mailer = new FailingMailTransport();
    const result = await sendNotification(prisma, mailer, {
      recipient: "sme@example.com",
      eventType: "POOL_JOINED",
      data: { poolId: "pool-1" },
    });

    expect(result.status).toBe("FAILED");
  });

  it("marks a log as bounced and disables future sends for that recipient", async () => {
    const mailer = new FakeMailTransport();
    const result = await sendNotification(prisma, mailer, {
      recipient: "bouncy@example.com",
      eventType: "REPAYMENT_RECEIVED",
    });

    const log = await prisma.emailLog.findUnique({ where: { id: result.emailLogId } });
    await recordBounce(prisma, {
      providerMessageId: log!.providerMessageId!,
      reason: "mailbox full",
    });

    const pref = await getOrCreatePreference(prisma, "bouncy@example.com");
    expect(pref.hasBounced).toBe(true);

    const second = await sendNotification(prisma, mailer, {
      recipient: "bouncy@example.com",
      eventType: "REPAYMENT_RECEIVED",
    });
    expect(second.status).toBe("SKIPPED_PREFERENCE");
  });

  it("throws EmailLogNotFoundError for an unknown providerMessageId", async () => {
    await expect(
      recordBounce(prisma, { providerMessageId: "does-not-exist" }),
    ).rejects.toBeInstanceOf(EmailLogNotFoundError);
  });
});
