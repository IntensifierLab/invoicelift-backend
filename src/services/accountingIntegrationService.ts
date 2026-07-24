import { randomBytes } from "node:crypto";
import type { AccountingConnection, PrismaClient } from "@prisma/client";
import { recordInvoiceAudit } from "../lib/invoiceAudit.js";
import { resolveInvoiceConflict } from "../lib/accounting/conflictResolution.js";
import {
  buildAuthorizeUrl,
  exchangeCodeForToken,
  fetchXeroTenantId,
  getProviderConfig,
} from "../lib/accounting/oauthClient.js";
import type { AccountingProviderClient } from "../lib/accounting/providerClient.js";
import type { AccountingProvider, ExternalReceivable, OAuthTokenSet } from "../lib/accounting/types.js";
import { createInvoice } from "./invoiceVerificationService.js";

export class OAuthStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OAuthStateError";
  }
}

export class ConnectionNotFoundError extends Error {
  constructor(smeAddress: string, provider: AccountingProvider) {
    super(`No ${provider} connection for ${smeAddress}`);
    this.name = "ConnectionNotFoundError";
  }
}

const PENDING_STATE_TTL_MS = 10 * 60 * 1000;

/**
 * OAuth `state` (CSRF binding between the authorize redirect and its
 * callback) pending a matching callback. In-memory and per-instance, which
 * is fine for this scaffold's single-instance deployment; a multi-instance
 * deployment would need this in Redis/the DB instead so any instance can
 * complete a callback that landed on a different one than issued it.
 */
const pendingStates = new Map<string, { provider: AccountingProvider; smeAddress: string; expiresAt: number }>();

function pruneExpiredStates(): void {
  const now = Date.now();
  for (const [state, entry] of pendingStates) {
    if (entry.expiresAt < now) pendingStates.delete(state);
  }
}

export function initiateConnection(
  provider: AccountingProvider,
  smeAddress: string,
): { authorizeUrl: string; state: string } {
  pruneExpiredStates();
  const state = randomBytes(24).toString("hex");
  pendingStates.set(state, { provider, smeAddress, expiresAt: Date.now() + PENDING_STATE_TTL_MS });
  return { authorizeUrl: buildAuthorizeUrl(provider, state), state };
}

export async function completeConnection(
  prisma: PrismaClient,
  provider: AccountingProvider,
  code: string,
  state: string,
): Promise<AccountingConnection> {
  pruneExpiredStates();
  const pending = pendingStates.get(state);
  if (!pending || pending.provider !== provider) {
    throw new OAuthStateError("Unknown or expired OAuth state — restart the connection flow.");
  }
  pendingStates.delete(state);

  const providerConfig = getProviderConfig(provider);
  const tokens = await exchangeCodeForToken(provider, code, providerConfig);

  const externalTenantId = tokens.externalTenantId ?? (await fetchXeroTenantId(tokens.accessToken));

  return prisma.accountingConnection.upsert({
    where: {
      smeAddress_provider: { smeAddress: pending.smeAddress, provider: provider.toUpperCase() as "XERO" | "QUICKBOOKS" },
    },
    create: {
      smeAddress: pending.smeAddress,
      provider: provider.toUpperCase() as "XERO" | "QUICKBOOKS",
      externalTenantId,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: new Date(tokens.expiresAt),
    },
    update: {
      externalTenantId,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: new Date(tokens.expiresAt),
    },
  });
}

function toTokenSet(connection: AccountingConnection): OAuthTokenSet {
  return {
    accessToken: connection.accessToken,
    refreshToken: connection.refreshToken,
    expiresAt: connection.expiresAt.getTime(),
    externalTenantId: connection.externalTenantId,
  };
}

export interface ImportSummary {
  created: number;
  updated: number;
  flaggedForReview: number;
  skipped: number;
}

/**
 * Pulls unpaid receivables from the SME's connected accounting system and
 * reconciles each against InvoiceLift's own invoice records via
 * `resolveInvoiceConflict`. `reference` is namespaced `${provider}:${
 * externalId}` so re-running an import is idempotent (a second run resolves
 * every receivable against the invoice the first run created, rather than
 * creating duplicates).
 */
export async function importEligibleReceivables(
  prisma: PrismaClient,
  client: AccountingProviderClient,
  provider: AccountingProvider,
  smeAddress: string,
  actor: string,
): Promise<ImportSummary> {
  const connection = await prisma.accountingConnection.findUnique({
    where: {
      smeAddress_provider: { smeAddress, provider: provider.toUpperCase() as "XERO" | "QUICKBOOKS" },
    },
  });
  if (!connection) {
    throw new ConnectionNotFoundError(smeAddress, provider);
  }

  const receivables = await client.listEligibleReceivables(toTokenSet(connection));
  const summary: ImportSummary = { created: 0, updated: 0, flaggedForReview: 0, skipped: 0 };

  for (const receivable of receivables) {
    await importOne(prisma, provider, receivable, actor, summary);
  }
  return summary;
}

async function importOne(
  prisma: PrismaClient,
  provider: AccountingProvider,
  receivable: ExternalReceivable,
  actor: string,
  summary: ImportSummary,
): Promise<void> {
  const reference = `${provider}:${receivable.externalId}`;
  const existing = await prisma.invoice.findUnique({ where: { reference } });
  const resolution = resolveInvoiceConflict(existing, receivable);

  switch (resolution.action) {
    case "create": {
      const invoice = await createInvoice(
        prisma,
        {
          reference,
          smeAddress: receivable.smeAddress,
          buyerAddress: receivable.buyerAddress,
          amount: receivable.amount,
          currency: receivable.currency,
          dueDate: new Date(receivable.dueDate),
        },
        actor,
      );
      // Supplements createInvoice's own INVOICE_CREATED entry — this one
      // records that the source was an accounting-system auto-import
      // specifically, distinct from an SME creating the invoice directly.
      await recordInvoiceAudit(prisma, {
        action: "INVOICE_AUTO_IMPORTED",
        actor,
        invoiceId: invoice.id,
        detail: { provider, receivable },
      });
      summary.created += 1;
      return;
    }
    case "update": {
      // existing is non-null whenever action is "update" or "flag_for_review"
      // (resolveInvoiceConflict only returns "create" for a null existing).
      const invoice = existing!;
      await prisma.invoice.update({
        where: { id: invoice.id },
        data: { amount: receivable.amount, currency: receivable.currency, dueDate: new Date(receivable.dueDate) },
      });
      await recordInvoiceAudit(prisma, {
        action: "INVOICE_SYNC_UPDATED",
        actor,
        invoiceId: invoice.id,
        detail: { provider, reason: resolution.reason, receivable },
      });
      summary.updated += 1;
      return;
    }
    case "flag_for_review": {
      await recordInvoiceAudit(prisma, {
        action: "INVOICE_SYNC_FLAGGED",
        actor,
        invoiceId: existing!.id,
        detail: { provider, reason: resolution.reason, receivable },
      });
      summary.flaggedForReview += 1;
      return;
    }
    case "skip":
      summary.skipped += 1;
  }
}
