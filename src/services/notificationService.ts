import type {
  EmailStatus,
  NotificationEventType,
  NotificationPreference,
  PrismaClient,
} from "@prisma/client";
import { renderTemplate, type TemplateData } from "../lib/emailTemplates.js";
import type { MailTransport } from "../lib/mailer.js";

type PreferenceField = "invoiceVerified" | "poolJoined" | "repaymentReceived" | "defaultFlagged";

const PREFERENCE_FIELD: Record<NotificationEventType, PreferenceField> = {
  INVOICE_VERIFIED: "invoiceVerified",
  POOL_JOINED: "poolJoined",
  REPAYMENT_RECEIVED: "repaymentReceived",
  DEFAULT_FLAGGED: "defaultFlagged",
};

export async function getOrCreatePreference(
  prisma: PrismaClient,
  recipient: string,
): Promise<NotificationPreference> {
  return prisma.notificationPreference.upsert({
    where: { recipient },
    update: {},
    create: { recipient },
  });
}

export interface UpdatePreferenceInput {
  invoiceVerified?: boolean;
  poolJoined?: boolean;
  repaymentReceived?: boolean;
  defaultFlagged?: boolean;
}

export async function updatePreference(
  prisma: PrismaClient,
  recipient: string,
  input: UpdatePreferenceInput,
): Promise<NotificationPreference> {
  return prisma.notificationPreference.upsert({
    where: { recipient },
    update: input,
    create: { recipient, ...input },
  });
}

export interface SendNotificationInput {
  recipient: string;
  eventType: NotificationEventType;
  data?: TemplateData;
}

export interface SendNotificationResult {
  status: EmailStatus;
  emailLogId: string;
}

export async function sendNotification(
  prisma: PrismaClient,
  mailer: MailTransport,
  input: SendNotificationInput,
): Promise<SendNotificationResult> {
  const preference = await getOrCreatePreference(prisma, input.recipient);
  const rendered = renderTemplate(input.eventType, input.data);
  const field = PREFERENCE_FIELD[input.eventType];

  if (preference.hasBounced || !preference[field]) {
    const log = await prisma.emailLog.create({
      data: {
        recipient: input.recipient,
        eventType: input.eventType,
        status: "SKIPPED_PREFERENCE",
        subject: rendered.subject,
      },
    });
    return { status: log.status, emailLogId: log.id };
  }

  try {
    const result = await mailer.send({
      to: input.recipient,
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
    });
    const log = await prisma.emailLog.create({
      data: {
        recipient: input.recipient,
        eventType: input.eventType,
        status: "SENT",
        subject: rendered.subject,
        providerMessageId: result.providerMessageId,
      },
    });
    return { status: log.status, emailLogId: log.id };
  } catch {
    const log = await prisma.emailLog.create({
      data: {
        recipient: input.recipient,
        eventType: input.eventType,
        status: "FAILED",
        subject: rendered.subject,
      },
    });
    return { status: log.status, emailLogId: log.id };
  }
}

export class EmailLogNotFoundError extends Error {
  constructor(providerMessageId: string) {
    super(`No email log found for providerMessageId "${providerMessageId}"`);
    this.name = "EmailLogNotFoundError";
  }
}

export interface RecordBounceInput {
  providerMessageId: string;
  reason?: string;
}

export async function recordBounce(prisma: PrismaClient, input: RecordBounceInput) {
  const existing = await prisma.emailLog.findUnique({
    where: { providerMessageId: input.providerMessageId },
  });
  if (!existing) {
    throw new EmailLogNotFoundError(input.providerMessageId);
  }

  const log = await prisma.emailLog.update({
    where: { providerMessageId: input.providerMessageId },
    data: { status: "BOUNCED", bounceReason: input.reason },
  });

  await prisma.notificationPreference.upsert({
    where: { recipient: log.recipient },
    update: { hasBounced: true },
    create: { recipient: log.recipient, hasBounced: true },
  });

  return log;
}
