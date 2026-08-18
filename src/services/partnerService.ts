import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import type { Partner, PrismaClient } from "@prisma/client";

const KEY_PREFIX = "ilift_live_";
const PREFIX_LOOKUP_LENGTH = 12;

export class PartnerNotFoundError extends Error {
  constructor(id: string) {
    super(`No partner found for id "${id}"`);
    this.name = "PartnerNotFoundError";
  }
}

function hashKey(rawKey: string): string {
  return createHash("sha256").update(rawKey).digest("hex");
}

function generateApiKey(): string {
  // 32 random bytes, base64url-encoded, is well beyond brute-force range and
  // URL/header-safe with no padding to strip.
  return `${KEY_PREFIX}${randomBytes(32).toString("base64url")}`;
}

export interface RegisterPartnerInput {
  name: string;
  contactEmail: string;
}

export interface RegisterPartnerResult {
  partner: Omit<Partner, "apiKeyHash">;
  apiKey: string;
}

/**
 * Registers a partner and returns the raw API key exactly once — only its
 * SHA-256 hash is persisted, so this is the only moment the caller can see
 * or copy the key. Losing it means issuing a new one (no recovery path).
 */
export async function registerPartner(
  prisma: PrismaClient,
  input: RegisterPartnerInput,
): Promise<RegisterPartnerResult> {
  const apiKey = generateApiKey();
  const apiKeyHash = hashKey(apiKey);
  const apiKeyPrefix = apiKey.slice(0, PREFIX_LOOKUP_LENGTH);

  const created = await prisma.partner.create({
    data: {
      name: input.name,
      contactEmail: input.contactEmail,
      apiKeyHash,
      apiKeyPrefix,
    },
  });

  const { apiKeyHash: _omit, ...partner } = created;
  return { partner, apiKey };
}

/**
 * Looks up a partner by the key's prefix (cheap, non-secret, indexed) then
 * confirms the full key with a constant-time hash comparison, so a valid
 * prefix alone can't be used to probe for a match. Returns null for an
 * unknown, revoked, or inactive key.
 */
export async function verifyApiKey(prisma: PrismaClient, rawKey: string): Promise<Partner | null> {
  if (!rawKey.startsWith(KEY_PREFIX)) return null;

  const prefix = rawKey.slice(0, PREFIX_LOOKUP_LENGTH);
  const candidates = await prisma.partner.findMany({ where: { apiKeyPrefix: prefix } });

  const suppliedHash = Buffer.from(hashKey(rawKey), "hex");
  for (const candidate of candidates) {
    const storedHash = Buffer.from(candidate.apiKeyHash, "hex");
    if (storedHash.length === suppliedHash.length && timingSafeEqual(storedHash, suppliedHash)) {
      return candidate.active && !candidate.revokedAt ? candidate : null;
    }
  }

  return null;
}

/** Revokes a partner's API key immediately; the key stops verifying but is not deleted. */
export async function revokePartner(prisma: PrismaClient, id: string): Promise<Partner> {
  try {
    return await prisma.partner.update({
      where: { id },
      data: { active: false, revokedAt: new Date() },
    });
  } catch {
    throw new PartnerNotFoundError(id);
  }
}
