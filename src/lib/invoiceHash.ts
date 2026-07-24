import { createHash } from "node:crypto";

export interface InvoiceHashInput {
  reference: string;
  smeAddress: string;
  buyerAddress: string;
  amount: number;
  currency: string;
  dueDate: string;
}

/**
 * Canonical fields are joined into a fixed-order, pipe-delimited string
 * (rather than JSON.stringify) so the byte sequence both parties sign never
 * depends on object key-insertion order.
 */
function canonicalString(input: InvoiceHashInput): string {
  return [
    input.reference,
    input.smeAddress,
    input.buyerAddress,
    input.amount,
    input.currency,
    input.dueDate,
  ].join("|");
}

export function computeInvoiceHash(input: InvoiceHashInput): Buffer {
  return createHash("sha256").update(canonicalString(input)).digest();
}

export function computeInvoiceHashHex(input: InvoiceHashInput): string {
  return computeInvoiceHash(input).toString("hex");
}
