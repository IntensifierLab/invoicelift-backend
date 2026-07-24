import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  verifyQuickBooksWebhookSignature,
  verifyXeroWebhookSignature,
} from "../../src/lib/accounting/webhookVerification.js";

const SECRET = "test-webhook-secret";

function sign(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body, "utf8").digest("base64");
}

describe("verifyXeroWebhookSignature", () => {
  it("accepts a correctly-signed body", () => {
    const body = JSON.stringify({ events: [{ eventType: "UPDATE" }] });
    const signature = sign(body, SECRET);
    expect(verifyXeroWebhookSignature(body, signature, SECRET)).toBe(true);
  });

  it("rejects a tampered body", () => {
    const body = JSON.stringify({ events: [{ eventType: "UPDATE" }] });
    const signature = sign(body, SECRET);
    const tampered = JSON.stringify({ events: [{ eventType: "DELETE" }] });
    expect(verifyXeroWebhookSignature(tampered, signature, SECRET)).toBe(false);
  });

  it("rejects a signature made with the wrong secret", () => {
    const body = JSON.stringify({ events: [] });
    const signature = sign(body, "wrong-secret");
    expect(verifyXeroWebhookSignature(body, signature, SECRET)).toBe(false);
  });

  it("rejects a missing signature header", () => {
    expect(verifyXeroWebhookSignature("{}", undefined, SECRET)).toBe(false);
  });

  it("rejects a signature of a different length without throwing", () => {
    expect(verifyXeroWebhookSignature("{}", "short", SECRET)).toBe(false);
  });
});

describe("verifyQuickBooksWebhookSignature", () => {
  it("accepts a correctly-signed body", () => {
    const body = JSON.stringify({ eventNotifications: [] });
    const signature = sign(body, SECRET);
    expect(verifyQuickBooksWebhookSignature(body, signature, SECRET)).toBe(true);
  });

  it("rejects a tampered body", () => {
    const body = JSON.stringify({ eventNotifications: [{ realmId: "1" }] });
    const signature = sign(body, SECRET);
    expect(verifyQuickBooksWebhookSignature(body + " ", signature, SECRET)).toBe(false);
  });
});
