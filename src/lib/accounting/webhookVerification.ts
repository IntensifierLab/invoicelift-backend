import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Xero and QuickBooks both authenticate webhook deliveries the same way:
 * HMAC-SHA256 over the *raw* request body, base64-encoded, compared against
 * a header value. They differ only in which secret and header — Xero's
 * `x-xero-signature` against the webhook signing key, QuickBooks'
 * `intuit-signature` against the Webhooks Verifier Token — so one function
 * covers both. `rawBody` must be the exact bytes as received (a string
 * re-serialized from parsed JSON will not reproduce the same signature).
 */
function verifyHmacSha256Signature(rawBody: string, signatureHeader: string | undefined, secret: string): boolean {
  if (!signatureHeader) return false;

  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("base64");

  const expectedBuf = Buffer.from(expected);
  const actualBuf = Buffer.from(signatureHeader);
  // Different-length buffers would throw in timingSafeEqual; treat that case
  // as "not equal" rather than letting the exception escape as a 500.
  if (expectedBuf.length !== actualBuf.length) return false;

  return timingSafeEqual(expectedBuf, actualBuf);
}

export function verifyXeroWebhookSignature(
  rawBody: string,
  signatureHeader: string | undefined,
  webhookKey: string,
): boolean {
  return verifyHmacSha256Signature(rawBody, signatureHeader, webhookKey);
}

export function verifyQuickBooksWebhookSignature(
  rawBody: string,
  signatureHeader: string | undefined,
  verifierToken: string,
): boolean {
  return verifyHmacSha256Signature(rawBody, signatureHeader, verifierToken);
}
