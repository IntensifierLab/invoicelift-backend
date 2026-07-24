import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { facilityDeps } from "../../src/lib/facilityDeps.js";
import { resetDb } from "../dbHelpers.js";
import type { AccountingProviderClient } from "../../src/lib/accounting/providerClient.js";
import type { ExternalReceivable } from "../../src/lib/accounting/types.js";

// exchangeCodeForToken/fetchXeroTenantId are real network calls — mocked so
// these tests never depend on live Xero credentials or connectivity.
// getProviderConfig is deliberately NOT mocked: buildAuthorizeUrl's own
// default parameter calls it directly (a same-module reference vi.mock
// can't intercept), so config.xero* is set for real below instead — see
// oauthClient.test.ts for getProviderConfig's own unit coverage.
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
    fetchXeroTenantId: vi.fn(async () => "tenant-1"),
  };
});

const { config } = await import("../../src/config/env.js");
const {
  completeConnection,
  ConnectionNotFoundError,
  importEligibleReceivables,
  initiateConnection,
  OAuthStateError,
} = await import("../../src/services/accountingIntegrationService.js");

const prisma = facilityDeps.prisma;
const ACTOR = "test:accounting-integration";
const SME_ADDRESS = "GSME1234567890";

class FakeProviderClient implements AccountingProviderClient {
  constructor(private readonly receivables: ExternalReceivable[]) {}
  async listEligibleReceivables(): Promise<ExternalReceivable[]> {
    return this.receivables;
  }
}

describe("accountingIntegrationService", () => {
  let previousXeroConfig: Pick<typeof config, "xeroClientId" | "xeroClientSecret" | "xeroRedirectUri">;

  beforeAll(() => {
    previousXeroConfig = {
      xeroClientId: config.xeroClientId,
      xeroClientSecret: config.xeroClientSecret,
      xeroRedirectUri: config.xeroRedirectUri,
    };
    config.xeroClientId = "test-client-id";
    config.xeroClientSecret = "test-client-secret";
    config.xeroRedirectUri = "https://app.test/callback";
  });

  afterAll(() => {
    Object.assign(config, previousXeroConfig);
  });

  beforeEach(async () => {
    await resetDb(prisma);
  });

  it("initiateConnection returns an authorize URL carrying the generated state", () => {
    const { authorizeUrl, state } = initiateConnection("xero", SME_ADDRESS);
    expect(new URL(authorizeUrl).searchParams.get("state")).toBe(state);
  });

  it("completeConnection rejects an unknown state", async () => {
    await expect(completeConnection(prisma, "xero", "code", "never-issued")).rejects.toBeInstanceOf(
      OAuthStateError,
    );
  });

  it("completeConnection persists the connection for a valid state", async () => {
    const { state } = initiateConnection("xero", SME_ADDRESS);
    const connection = await completeConnection(prisma, "xero", "auth-code", state);

    expect(connection.smeAddress).toBe(SME_ADDRESS);
    expect(connection.provider).toBe("XERO");
    expect(connection.externalTenantId).toBe("tenant-1");
  });

  it("completeConnection rejects reusing the same state twice", async () => {
    const { state } = initiateConnection("xero", SME_ADDRESS);
    await completeConnection(prisma, "xero", "auth-code", state);
    await expect(completeConnection(prisma, "xero", "auth-code", state)).rejects.toBeInstanceOf(
      OAuthStateError,
    );
  });

  it("importEligibleReceivables throws when there's no connection", async () => {
    await expect(
      importEligibleReceivables(prisma, new FakeProviderClient([]), "xero", SME_ADDRESS, ACTOR),
    ).rejects.toBeInstanceOf(ConnectionNotFoundError);
  });

  it("creates a new invoice for a receivable with no existing match", async () => {
    const { state } = initiateConnection("xero", SME_ADDRESS);
    await completeConnection(prisma, "xero", "auth-code", state);

    const client = new FakeProviderClient([
      {
        externalId: "INV-1",
        smeAddress: SME_ADDRESS,
        buyerAddress: "GBUYER",
        amount: 5_000,
        currency: "USD",
        dueDate: "2026-09-01",
        paid: false,
      },
    ]);

    const summary = await importEligibleReceivables(prisma, client, "xero", SME_ADDRESS, ACTOR);
    expect(summary).toEqual({ created: 1, updated: 0, flaggedForReview: 0, skipped: 0 });

    const invoice = await prisma.invoice.findUnique({ where: { reference: "xero:INV-1" } });
    expect(invoice?.amount).toBe(5_000);

    const auditEntries = await prisma.invoiceAuditEntry.findMany({ where: { invoiceId: invoice!.id } });
    expect(auditEntries.map((e) => e.action)).toContain("INVOICE_AUTO_IMPORTED");
  });

  it("re-importing the same receivable is idempotent (skip, no duplicate)", async () => {
    const { state } = initiateConnection("xero", SME_ADDRESS);
    await completeConnection(prisma, "xero", "auth-code", state);

    const receivable: ExternalReceivable = {
      externalId: "INV-2",
      smeAddress: SME_ADDRESS,
      buyerAddress: "GBUYER",
      amount: 2_000,
      currency: "USD",
      dueDate: "2026-09-15",
      paid: false,
    };
    const client = new FakeProviderClient([receivable]);

    const first = await importEligibleReceivables(prisma, client, "xero", SME_ADDRESS, ACTOR);
    expect(first.created).toBe(1);

    const second = await importEligibleReceivables(prisma, client, "xero", SME_ADDRESS, ACTOR);
    expect(second).toEqual({ created: 0, updated: 0, flaggedForReview: 0, skipped: 1 });

    const invoices = await prisma.invoice.findMany({ where: { reference: "xero:INV-2" } });
    expect(invoices).toHaveLength(1);
  });

  it("flags a mismatched receivable for review instead of overwriting a signed invoice", async () => {
    const { state } = initiateConnection("xero", SME_ADDRESS);
    await completeConnection(prisma, "xero", "auth-code", state);

    const client = new FakeProviderClient([
      {
        externalId: "INV-3",
        smeAddress: SME_ADDRESS,
        buyerAddress: "GBUYER",
        amount: 3_000,
        currency: "USD",
        dueDate: "2026-09-20",
        paid: false,
      },
    ]);
    await importEligibleReceivables(prisma, client, "xero", SME_ADDRESS, ACTOR);

    const invoice = await prisma.invoice.findUnique({ where: { reference: "xero:INV-3" } });
    await prisma.invoice.update({ where: { id: invoice!.id }, data: { status: "VERIFIED" } });

    const changedClient = new FakeProviderClient([
      {
        externalId: "INV-3",
        smeAddress: SME_ADDRESS,
        buyerAddress: "GBUYER",
        amount: 9_999,
        currency: "USD",
        dueDate: "2026-09-20",
        paid: false,
      },
    ]);
    const summary = await importEligibleReceivables(prisma, changedClient, "xero", SME_ADDRESS, ACTOR);
    expect(summary).toEqual({ created: 0, updated: 0, flaggedForReview: 1, skipped: 0 });

    const unchanged = await prisma.invoice.findUnique({ where: { reference: "xero:INV-3" } });
    expect(unchanged?.amount).toBe(3_000);

    const auditEntries = await prisma.invoiceAuditEntry.findMany({ where: { invoiceId: invoice!.id } });
    expect(auditEntries.map((e) => e.action)).toContain("INVOICE_SYNC_FLAGGED");
  });
});
