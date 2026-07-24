import type { OAuthTokenSet } from "./types.js";
import type { ExternalReceivable } from "./types.js";

export interface AccountingProviderClient {
  /** Eligible = unpaid, i.e. not yet reported settled by the accounting
   * system — matches this issue's "auto-import eligible unpaid
   * receivables" criterion. */
  listEligibleReceivables(tokens: OAuthTokenSet): Promise<ExternalReceivable[]>;
}

/**
 * Always returns an empty list, so `importEligibleReceivables` is safe to
 * call (and test) with no risk of inventing invoices before a real provider
 * client exists.
 *
 * A real client (Xero's `Invoices` endpoint filtered to `Status==AUTHORISED`,
 * or QuickBooks' `Query` on the `Invoice` entity with `Balance > 0`) needs
 * field-mapping against each provider's actual response shape, which isn't
 * verifiable without a live sandbox account for either — left as a follow-up
 * once one is available. The OAuth connection lifecycle and conflict
 * resolution this PR ships don't depend on that mapping existing yet.
 */
export class StubAccountingProviderClient implements AccountingProviderClient {
  async listEligibleReceivables(): Promise<ExternalReceivable[]> {
    return [];
  }
}
