import { config } from "../../config/env.js";
import type { AccountingProvider, OAuthProviderConfig, OAuthTokenSet } from "./types.js";

export class ProviderNotConfiguredError extends Error {
  constructor(provider: AccountingProvider) {
    super(
      `${provider} is not configured — set ${provider.toUpperCase()}_CLIENT_ID/` +
        `${provider.toUpperCase()}_CLIENT_SECRET/${provider.toUpperCase()}_REDIRECT_URI.`,
    );
    this.name = "ProviderNotConfiguredError";
  }
}

export class OAuthExchangeError extends Error {
  constructor(provider: AccountingProvider, detail: string) {
    super(`${provider} token exchange failed: ${detail}`);
    this.name = "OAuthExchangeError";
  }
}

/**
 * Xero and QuickBooks are both standard authorization-code OAuth2, differing
 * only in endpoint URLs and scope syntax — so one implementation covers both,
 * parameterized by this per-provider config rather than two near-duplicate
 * clients.
 */
export function getProviderConfig(provider: AccountingProvider): OAuthProviderConfig {
  if (provider === "xero") {
    if (!config.xeroClientId || !config.xeroClientSecret || !config.xeroRedirectUri) {
      throw new ProviderNotConfiguredError("xero");
    }
    return {
      clientId: config.xeroClientId,
      clientSecret: config.xeroClientSecret,
      redirectUri: config.xeroRedirectUri,
      authorizeUrl: "https://login.xero.com/identity/connect/authorize",
      tokenUrl: "https://identity.xero.com/connect/token",
      // accounting.transactions.read: list/read invoices. offline_access:
      // issues a refresh token (Xero access tokens are 30 minutes).
      scope: "openid profile accounting.transactions.read offline_access",
    };
  }

  if (!config.quickbooksClientId || !config.quickbooksClientSecret || !config.quickbooksRedirectUri) {
    throw new ProviderNotConfiguredError("quickbooks");
  }
  return {
    clientId: config.quickbooksClientId,
    clientSecret: config.quickbooksClientSecret,
    redirectUri: config.quickbooksRedirectUri,
    authorizeUrl: "https://appcenter.intuit.com/connect/oauth2",
    tokenUrl: "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer",
    scope: "com.intuit.quickbooks.accounting",
  };
}

/**
 * The URL to redirect the SME to so they can grant InvoiceLift access to
 * their accounting data. `state` is opaque here — the caller is responsible
 * for generating an unguessable value and verifying it matches on callback
 * (CSRF protection), since that binding is inherently stateful and doesn't
 * belong in a pure URL builder.
 */
export function buildAuthorizeUrl(
  provider: AccountingProvider,
  state: string,
  providerConfig: OAuthProviderConfig = getProviderConfig(provider),
): string {
  const url = new URL(providerConfig.authorizeUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", providerConfig.clientId);
  url.searchParams.set("redirect_uri", providerConfig.redirectUri);
  url.searchParams.set("scope", providerConfig.scope);
  url.searchParams.set("state", state);
  return url.toString();
}

interface TokenResponseBody {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  /** QuickBooks returns this in the token response; Xero returns the
   * equivalent (tenant id) from a separate /connections call the caller
   * makes right after — see `completeConnection` in
   * accountingIntegrationService.ts. */
  realmId?: string;
}

/**
 * Exchanges an authorization `code` for an access/refresh token pair.
 * `fetchImpl` defaults to the global `fetch` but is overridable so this stays
 * unit-testable without a real HTTP call or live provider credentials.
 */
export async function exchangeCodeForToken(
  provider: AccountingProvider,
  code: string,
  providerConfig: OAuthProviderConfig = getProviderConfig(provider),
  fetchImpl: typeof fetch = fetch,
): Promise<Omit<OAuthTokenSet, "externalTenantId"> & { externalTenantId?: string }> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: providerConfig.redirectUri,
  });

  const basicAuth = Buffer.from(`${providerConfig.clientId}:${providerConfig.clientSecret}`).toString(
    "base64",
  );

  const response = await fetchImpl(providerConfig.tokenUrl, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      authorization: `Basic ${basicAuth}`,
      accept: "application/json",
    },
    body,
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => response.statusText);
    throw new OAuthExchangeError(provider, `HTTP ${response.status}: ${detail}`);
  }

  const json = (await response.json()) as TokenResponseBody;
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: Date.now() + json.expires_in * 1000,
    externalTenantId: json.realmId,
  };
}

/** Refreshes an expiring/expired token using its refresh token. Same
 * grant-type dance as the initial exchange, minus the redirect/code. */
export async function refreshAccessToken(
  provider: AccountingProvider,
  refreshToken: string,
  providerConfig: OAuthProviderConfig = getProviderConfig(provider),
  fetchImpl: typeof fetch = fetch,
): Promise<Pick<OAuthTokenSet, "accessToken" | "refreshToken" | "expiresAt">> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  const basicAuth = Buffer.from(`${providerConfig.clientId}:${providerConfig.clientSecret}`).toString(
    "base64",
  );

  const response = await fetchImpl(providerConfig.tokenUrl, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      authorization: `Basic ${basicAuth}`,
      accept: "application/json",
    },
    body,
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => response.statusText);
    throw new OAuthExchangeError(provider, `HTTP ${response.status}: ${detail}`);
  }

  const json = (await response.json()) as TokenResponseBody;
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: Date.now() + json.expires_in * 1000,
  };
}

interface XeroConnection {
  tenantId: string;
  tenantName: string;
}

/**
 * Xero's token response has no tenant id — unlike QuickBooks' `realmId`, it
 * has to be looked up with a follow-up call once the access token is minted.
 * Takes the first connection, since this app connects one SME's accounting
 * org at a time (a user with access to multiple Xero orgs would need a
 * follow-up "pick an org" step this scaffold doesn't have yet).
 */
export async function fetchXeroTenantId(
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const response = await fetchImpl("https://api.xero.com/connections", {
    headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" },
  });
  if (!response.ok) {
    throw new OAuthExchangeError("xero", `connections lookup HTTP ${response.status}`);
  }
  const connections = (await response.json()) as XeroConnection[];
  if (connections.length === 0) {
    throw new OAuthExchangeError("xero", "no connected organisations returned");
  }
  return connections[0].tenantId;
}
