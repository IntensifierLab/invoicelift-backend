import { randomUUID } from "node:crypto";
import { config } from "../config/env.js";

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface MailSendResult {
  providerMessageId: string;
}

export interface MailTransport {
  send(message: MailMessage): Promise<MailSendResult>;
}

/**
 * Logs the message and returns a synthetic provider message id so the full
 * notification flow (send -> log -> bounce webhook) is runnable and testable
 * without a live email provider. Swap for a real transport behind this same
 * interface when one is wired up.
 */
export class StubMailTransport implements MailTransport {
  async send(message: MailMessage): Promise<MailSendResult> {
    const providerMessageId = `stub_${randomUUID()}`;
    console.log(`[mail:stub] -> ${message.to} :: ${message.subject} (${providerMessageId})`);
    return { providerMessageId };
  }
}

export class SmtpMailTransport implements MailTransport {
  async send(): Promise<MailSendResult> {
    throw new Error(
      "SmtpMailTransport is not implemented yet — set MAIL_TRANSPORT_MODE=stub, or implement SMTP/API integration before enabling this mode.",
    );
  }
}

export function createMailTransport(): MailTransport {
  switch (config.mailTransportMode) {
    case "smtp":
      return new SmtpMailTransport();
    case "stub":
    default:
      return new StubMailTransport();
  }
}
