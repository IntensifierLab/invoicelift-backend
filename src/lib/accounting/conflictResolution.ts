import type { Invoice } from "@prisma/client";
import type { ExternalReceivable } from "./types.js";

export type ConflictAction = "create" | "update" | "skip" | "flag_for_review";

export interface ConflictResolution {
  action: ConflictAction;
  reason: string;
}

/** Core invoice fields both sides can disagree on. */
function coreFieldsDiffer(existing: Invoice, incoming: ExternalReceivable): boolean {
  return (
    existing.amount !== incoming.amount ||
    existing.currency !== incoming.currency ||
    existing.dueDate.toISOString().slice(0, 10) !== incoming.dueDate.slice(0, 10)
  );
}

/**
 * Decides what to do when an auto-imported receivable from Xero/QuickBooks
 * matches an invoice InvoiceLift already knows about (`existing` is `null`
 * for a genuinely new receivable — the caller should `create`).
 *
 * Strategy: an invoice's on-chain signature workflow is the source of truth
 * once it starts, so the accounting system is only allowed to `update` core
 * fields (amount/currency/dueDate) while the invoice is still at
 * `PENDING_SME_SIGNATURE` — before anyone has signed anything against the
 * current values. Once the SME has signed (or the invoice is verified/
 * rejected), a mismatch from the accounting side is `flag_for_review`
 * (an audit entry, no silent overwrite) rather than an automatic update or a
 * silent drop — the two systems disagreeing after signatures exist is
 * exactly the case a human should look at.
 */
export function resolveInvoiceConflict(
  existing: Invoice | null,
  incoming: ExternalReceivable,
): ConflictResolution {
  if (!existing) {
    return { action: "create", reason: "No existing invoice for this receivable." };
  }

  const differs = coreFieldsDiffer(existing, incoming);

  if (existing.status === "PENDING_SME_SIGNATURE") {
    return differs
      ? { action: "update", reason: "Not yet signed — safe to sync core fields from the accounting system." }
      : { action: "skip", reason: "Already in sync; no signature exists yet to protect." };
  }

  if (!differs) {
    return { action: "skip", reason: "Fields match; nothing to reconcile." };
  }

  return {
    action: "flag_for_review",
    reason: `Accounting system reports different terms, but this invoice is already ${existing.status} ` +
      "— a signature exists against the current values, so it will not be overwritten automatically.",
  };
}
