import type { NotificationEventType } from "@prisma/client";

export type TemplateData = Record<string, string | number>;

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

function escapeHtml(value: string | number): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

type TemplateFn = (data: TemplateData) => RenderedEmail;

const templates: Record<NotificationEventType, TemplateFn> = {
  INVOICE_VERIFIED: (data) => {
    const reference = data.reference ?? "";
    return {
      subject: `Invoice ${reference} verified`,
      text: `Invoice ${reference} has been verified and is ready for funding.`,
      html: `<p>Invoice <strong>${escapeHtml(reference)}</strong> has been verified and is ready for funding.</p>`,
    };
  },
  POOL_JOINED: (data) => {
    const poolId = data.poolId ?? "";
    return {
      subject: `You joined pool ${poolId}`,
      text: `You have successfully joined pool ${poolId}.`,
      html: `<p>You have successfully joined pool <strong>${escapeHtml(poolId)}</strong>.</p>`,
    };
  },
  REPAYMENT_RECEIVED: (data) => {
    const reference = data.reference ?? "your invoice";
    const amount = data.amount ?? "";
    const currency = data.currency ?? "";
    return {
      subject: `Repayment received for ${reference}`,
      text: `A repayment of ${amount} ${currency} was received for ${reference}.`,
      html: `<p>A repayment of <strong>${escapeHtml(amount)} ${escapeHtml(currency)}</strong> was received for ${escapeHtml(reference)}.</p>`,
    };
  },
  REPAYMENT_REMINDER: (data) => {
    const reference = data.reference ?? "your invoice";
    const amount = data.amount ?? "";
    const currency = data.currency ?? "";
    const dueDate = data.dueDate ?? "soon";
    return {
      subject: `Repayment due for ${reference}`,
      text: `A repayment of ${amount} ${currency} for ${reference} is due on ${dueDate}.`,
      html: `<p>A repayment of <strong>${escapeHtml(amount)} ${escapeHtml(currency)}</strong> for ${escapeHtml(reference)} is due on <strong>${escapeHtml(dueDate)}</strong>.</p>`,
    };
  },
  DEFAULT_FLAGGED: (data) => {
    const reference = data.reference ?? "A facility";
    return {
      subject: `Default flagged on ${reference}`,
      text: `${reference} has been flagged as delinquent or in default. Review is required.`,
      html: `<p><strong>${escapeHtml(reference)}</strong> has been flagged as delinquent or in default. Review is required.</p>`,
    };
  },
};

export function renderTemplate(
  eventType: NotificationEventType,
  data: TemplateData = {},
): RenderedEmail {
  return templates[eventType](data);
}
