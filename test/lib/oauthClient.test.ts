import { describe, expect, it, vi } from "vitest";
import {
  OAuthExchangeError,
  ProviderNotConfiguredError,
  buildAuthorizeUrl,
  exchangeCodeForToken,
  fetchXeroTenantId,
  getProviderConfig,
  refreshAccessToken,
} from "../../src/lib/accounting/oauthClient.js";
import type { OAuthProviderConfig } from "../../src/lib/accounting/types.js";

const FAKE_CONFIG: OAuthProviderConfig = {
  clientId: "client-123",
  clientSecret: "secret-456",
  redirectUri: "https://app.invoicelift.test/callback",
  authorizeUrl: "https://provider.test/authorize",
  tokenUrl: "https://provider.test/token",
  scope: "read write",
};

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    statusText: ok ? "OK" : "Error",
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

describe("getProviderConfig", () => {
  it("throws ProviderNotConfiguredError when no env vars are set", () => {
    expect(() => getProviderConfig("xero")).toThrow(ProviderNotConfiguredError);
    expect(() => getProviderConfig("quickbooks")).toThrow(ProviderNotConfiguredError);
  });
});

describe("buildAuthorizeUrl", () => {
  it("builds a well-formed authorize URL with state and scope", () => {
    const url = new URL(buildAuthorizeUrl("xero", "state-abc", FAKE_CONFIG));
    expect(url.origin + url.pathname).toBe("https://provider.test/authorize");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe("client-123");
    expect(url.searchParams.get("redirect_uri")).toBe(FAKE_CONFIG.redirectUri);
    expect(url.searchParams.get("scope")).toBe("read write");
    expect(url.searchParams.get("state")).toBe("state-abc");
  });
});

describe("exchangeCodeForToken", () => {
  it("exchanges a code for a token set, deriving expiresAt from expires_in", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ access_token: "at", refresh_token: "rt", expires_in: 3600, realmId: "realm-1" }),
    );
    const before = Date.now();

    const tokens = await exchangeCodeForToken("quickbooks", "auth-code", FAKE_CONFIG, fetchMock);

    expect(tokens.accessToken).toBe("at");
    expect(tokens.refreshToken).toBe("rt");
    expect(tokens.externalTenantId).toBe("realm-1");
    expect(tokens.expiresAt).toBeGreaterThanOrEqual(before + 3600 * 1000);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(FAKE_CONFIG.tokenUrl);
    expect(init.method).toBe("POST");
    expect(init.headers.authorization).toMatch(/^Basic /);
    expect(String(init.body)).toContain("grant_type=authorization_code");
    expect(String(init.body)).toContain("code=auth-code");
  });

  it("throws OAuthExchangeError on a non-OK response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: "invalid_grant" }, false, 400));
    await expect(exchangeCodeForToken("xero", "bad-code", FAKE_CONFIG, fetchMock)).rejects.toThrow(
      OAuthExchangeError,
    );
  });
});

describe("refreshAccessToken", () => {
  it("uses the refresh_token grant", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ access_token: "new-at", refresh_token: "new-rt", expires_in: 1800 }),
    );

    const tokens = await refreshAccessToken("xero", "old-rt", FAKE_CONFIG, fetchMock);

    expect(tokens.accessToken).toBe("new-at");
    const [, init] = fetchMock.mock.calls[0];
    expect(String(init.body)).toContain("grant_type=refresh_token");
    expect(String(init.body)).toContain("refresh_token=old-rt");
  });
});

describe("fetchXeroTenantId", () => {
  it("returns the first connection's tenantId", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse([{ tenantId: "tenant-1", tenantName: "Acme" }]));
    await expect(fetchXeroTenantId("access-token", fetchMock)).resolves.toBe("tenant-1");
  });

  it("throws when there are no connected organisations", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([]));
    await expect(fetchXeroTenantId("access-token", fetchMock)).rejects.toThrow(OAuthExchangeError);
  });
});
