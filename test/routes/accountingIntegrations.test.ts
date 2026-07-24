import { createHmac } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDb } from "../dbHelpers.js";

// Mocked so this HTTP-layer test never depends on live Xero credentials or
// connectivity — see test/services/accountingIntegrationService.test.ts for
// why getProviderConfig itself is left real (config.xero* is set below)
// rather than mocked.
vi.mock("../../src/lib/accounting/oauthClient.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/lib/accounting/oauthClient.js")>();
  return {
    ...actual,
    exchangeCodeForToken: vi.fn(async () => ({
      accessToken: "at",
      refreshToken: "rt",
      expiresAt: Date.now() + 3_600_000,
      externalTenantId: "tenant-1",
    })),
  };
});

const { config } = await import("../../src/config/env.js");
const { facilityDeps } = await import("../../src/lib/facilityDeps.js");
const { buildServer } = await import("../../src/server.js");

const WEBHOOK_KEY = "test-xero-webhook-key";

describe("accounting integration routes", () => {
  let app: FastifyInstance;
  let previousConfig: Pick<typeof config, "xeroClientId" | "xeroClientSecret" | "xeroRedirectUri" | "xeroWebhookKey">;

  beforeAll(async () => {
    previousConfig = {
      xeroClientId: config.xeroClientId,
      xeroClientSecret: config.xeroClientSecret,
      xeroRedirectUri: config.xeroRedirectUri,
      xeroWebhookKey: config.xeroWebhookKey,
    };
    config.xeroClientId = "test-client-id";
    config.xeroClientSecret = "test-client-secret";
    config.xeroRedirectUri = "https://app.test/callback";
    config.xeroWebhookKey = WEBHOOK_KEY;
    app = await buildServer();
  });

  afterAll(async () => {
    await app.close();
    Object.assign(config, previousConfig);
  });

  beforeEach(async () => {
    await resetDb(facilityDeps.prisma);
  });

  it("GET /integrations/:provider/authorize returns an authorize URL", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/integrations/xero/authorize?smeAddress=GSME1",
    });
    expect(res.statusCode).toBe(200);
    const url = new URL(res.json().authorizeUrl);
    expect(url.searchParams.get("client_id")).toBe("test-client-id");
    expect(url.searchParams.get("state")).toBeTruthy();
  });

  it("GET /integrations/:provider/authorize 400s on an unknown provider", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/integrations/gnucash/authorize?smeAddress=GSME1",
    });
    expect(res.statusCode).toBe(400);
  });

  it("GET /integrations/:provider/callback 400s on an unrecognized state", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/integrations/xero/callback?code=abc&state=never-issued",
    });
    expect(res.statusCode).toBe(400);
  });

  it("completes the connection round-trip through authorize -> callback", async () => {
    const authRes = await app.inject({
      method: "GET",
      url: "/api/v1/integrations/xero/authorize?smeAddress=GSME2",
    });
    const state = new URL(authRes.json().authorizeUrl).searchParams.get("state");

    const callbackRes = await app.inject({
      method: "GET",
      url: `/api/v1/integrations/xero/callback?code=auth-code&state=${state}`,
    });
    expect(callbackRes.statusCode).toBe(200);
    expect(callbackRes.json().provider).toBe("XERO");
    expect(callbackRes.json().externalTenantId).toBe("tenant-1");
  });

  it("POST /integrations/:provider/import 404s with no connection", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/integrations/xero/import",
      payload: { smeAddress: "GSME-NO-CONNECTION" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("POST /integrations/:provider/webhook rejects a missing signature", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/integrations/xero/webhook",
      payload: { events: [] },
    });
    expect(res.statusCode).toBe(401);
  });

  it("POST /integrations/:provider/webhook rejects an incorrect signature", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/integrations/xero/webhook",
      headers: { "x-xero-signature": "not-the-right-signature" },
      payload: { events: [] },
    });
    expect(res.statusCode).toBe(401);
  });

  it("POST /integrations/:provider/webhook accepts a correctly-signed body", async () => {
    const body = JSON.stringify({ events: [] });
    const signature = createHmac("sha256", WEBHOOK_KEY).update(body, "utf8").digest("base64");

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/integrations/xero/webhook",
      headers: { "content-type": "application/json", "x-xero-signature": signature },
      payload: body,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ received: true });
  });
});
