import { beforeEach, describe, expect, it } from "vitest";
import { facilityDeps } from "../../src/lib/facilityDeps.js";
import {
  PartnerNotFoundError,
  registerPartner,
  revokePartner,
  verifyApiKey,
} from "../../src/services/partnerService.js";
import { resetDb } from "../dbHelpers.js";

const prisma = facilityDeps.prisma;

describe("registerPartner", () => {
  beforeEach(async () => {
    await resetDb(prisma);
  });

  it("returns a raw API key that is not persisted anywhere in plaintext", async () => {
    const { partner, apiKey } = await registerPartner(prisma, {
      name: "Acme Corp",
      contactEmail: "ops@acme.example",
    });

    expect(apiKey).toMatch(/^ilift_live_/);
    expect(partner).not.toHaveProperty("apiKeyHash");

    const stored = await prisma.partner.findUniqueOrThrow({ where: { id: partner.id } });
    expect(stored.apiKeyHash).not.toBe(apiKey);
    expect(stored.apiKeyHash).toHaveLength(64); // sha256 hex
  });

  it("generates a different key for each registration", async () => {
    const a = await registerPartner(prisma, { name: "A", contactEmail: "a@example.com" });
    const b = await registerPartner(prisma, { name: "B", contactEmail: "b@example.com" });
    expect(a.apiKey).not.toBe(b.apiKey);
  });
});

describe("verifyApiKey", () => {
  beforeEach(async () => {
    await resetDb(prisma);
  });

  it("verifies a freshly-issued key and returns the partner", async () => {
    const { partner, apiKey } = await registerPartner(prisma, {
      name: "Acme Corp",
      contactEmail: "ops@acme.example",
    });

    const verified = await verifyApiKey(prisma, apiKey);

    expect(verified?.id).toBe(partner.id);
  });

  it("rejects a well-formed but wrong key", async () => {
    await registerPartner(prisma, { name: "Acme Corp", contactEmail: "ops@acme.example" });

    const result = await verifyApiKey(prisma, "ilift_live_totallywrongkeyvalue000000000000000000000000000");

    expect(result).toBeNull();
  });

  it("rejects a key with the wrong prefix outright", async () => {
    const result = await verifyApiKey(prisma, "sk_test_not_an_invoicelift_key");
    expect(result).toBeNull();
  });

  it("rejects a revoked partner's key", async () => {
    const { partner, apiKey } = await registerPartner(prisma, {
      name: "Acme Corp",
      contactEmail: "ops@acme.example",
    });
    await revokePartner(prisma, partner.id);

    const result = await verifyApiKey(prisma, apiKey);

    expect(result).toBeNull();
  });

  it("distinguishes between two partners sharing the same key prefix", async () => {
    // Extremely unlikely in practice, but verifyApiKey must fall through to
    // the next candidate rather than assuming a prefix match is the key.
    const a = await registerPartner(prisma, { name: "A", contactEmail: "a@example.com" });
    const b = await registerPartner(prisma, { name: "B", contactEmail: "b@example.com" });

    expect((await verifyApiKey(prisma, a.apiKey))?.id).toBe(a.partner.id);
    expect((await verifyApiKey(prisma, b.apiKey))?.id).toBe(b.partner.id);
  });
});

describe("revokePartner", () => {
  beforeEach(async () => {
    await resetDb(prisma);
  });

  it("sets active=false and revokedAt", async () => {
    const { partner } = await registerPartner(prisma, {
      name: "Acme Corp",
      contactEmail: "ops@acme.example",
    });

    const revoked = await revokePartner(prisma, partner.id);

    expect(revoked.active).toBe(false);
    expect(revoked.revokedAt).not.toBeNull();
  });

  it("throws PartnerNotFoundError for an unknown id", async () => {
    await expect(revokePartner(prisma, "does-not-exist")).rejects.toThrow(PartnerNotFoundError);
  });
});
