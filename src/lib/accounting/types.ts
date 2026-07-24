export type AccountingProvider = "xero" | "quickbooks";

export interface OAuthProviderConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  authorizeUrl: string;
  tokenUrl: string;
  scope: string;
}

export interface OAuthTokenSet {
  accessToken: string;
  refreshToken: string;
  /** Epoch milliseconds. */
  expiresAt: number;
  /** Xero: the connected tenant ("organisation"). QuickBooks: the realm id.
   * Both providers return this alongside (or shortly after) the token
   * exchange, and it's required for every subsequent API call. */
  externalTenantId: string;
}

/** An unpaid receivable as reported by the external accounting system,
 * normalized to the shape `createInvoice` (invoiceVerificationService)
 * expects — the provider-specific client is responsible for mapping its
 * native response into this. */
export interface ExternalReceivable {
  /** The provider's own invoice id — used as (part of) `reference` so a
   * re-import is idempotent rather than creating a duplicate. */
  externalId: string;
  smeAddress: string;
  buyerAddress: string;
  amount: number;
  currency: string;
  dueDate: string;
  /** True once the accounting system reports the receivable settled — used
   * to decide whether a webhook status change should be imported/ignored. */
  paid: boolean;
}
