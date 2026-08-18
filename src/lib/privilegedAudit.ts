import { createHash } from "node:crypto";
import type { Prisma, PrismaClient, PrivilegedActionCategory } from "@prisma/client";
import { Keypair } from "@stellar/stellar-sdk";
import { config } from "../config/env.js";

export interface RecordPrivilegedAuditParams {
  category: PrivilegedActionCategory;
  action: string;
  actor: string;
  resourceType: string;
  resourceId: string;
  beforeState?: Record<string, unknown> | null;
  afterState?: Record<string, unknown> | null;
}

/** Append-only: this is deliberately the only way anything in the codebase writes to PrivilegedAuditEntry. */
export async function recordPrivilegedAudit(
  prisma: PrismaClient,
  params: RecordPrivilegedAuditParams,
): Promise<void> {
  await prisma.privilegedAuditEntry.create({
    data: {
      category: params.category,
      action: params.action,
      actor: params.actor,
      resourceType: params.resourceType,
      resourceId: params.resourceId,
      beforeState: (params.beforeState ?? undefined) as Prisma.InputJsonValue | undefined,
      afterState: (params.afterState ?? undefined) as Prisma.InputJsonValue | undefined,
    },
  });
}

export interface PrivilegedAuditQuery {
  actor?: string;
  category?: PrivilegedActionCategory;
  action?: string;
  from?: Date;
  to?: Date;
  limit?: number;
  offset?: number;
}

export async function listPrivilegedAudit(prisma: PrismaClient, query: PrivilegedAuditQuery) {
  return prisma.privilegedAuditEntry.findMany({
    where: {
      actor: query.actor,
      category: query.category,
      action: query.action,
      createdAt:
        query.from || query.to
          ? {
              gte: query.from,
              lte: query.to,
            }
          : undefined,
    },
    orderBy: { createdAt: "desc" },
    take: query.limit ?? 50,
    skip: query.offset ?? 0,
  });
}

let cachedExportKeypair: Keypair | undefined;

/**
 * Lazily resolves the signing keypair. Falls back to a freshly generated,
 * process-lifetime keypair when AUDIT_EXPORT_SIGNING_SECRET isn't set —
 * exports still get a valid, verifiable signature within that process,
 * they just won't verify against a keypair from a previous restart. Set
 * the env var in any environment where that matters.
 */
function getExportKeypair(): Keypair {
  if (config.auditExportSigningSecret) {
    return Keypair.fromSecret(config.auditExportSigningSecret);
  }
  if (!cachedExportKeypair) {
    cachedExportKeypair = Keypair.random();
  }
  return cachedExportKeypair;
}

export interface SignedAuditExport {
  entries: unknown[];
  exportedAt: string;
  entryCount: number;
  contentHash: string;
  signature: string;
  signerPublicKey: string;
}

/**
 * Signs a canonical hash of the export payload (not the JSON text itself,
 * so key order / whitespace differences in re-serialization can't change
 * whether a signature verifies) with SEP-53 message signing.
 */
export function signAuditExport(entries: unknown[]): SignedAuditExport {
  const exportedAt = new Date().toISOString();
  const canonical = JSON.stringify({ entries, exportedAt, entryCount: entries.length });
  const contentHash = createHash("sha256").update(canonical).digest("hex");

  const keypair = getExportKeypair();
  const signature = keypair.signMessage(contentHash).toString("base64");

  return {
    entries,
    exportedAt,
    entryCount: entries.length,
    contentHash,
    signature,
    signerPublicKey: keypair.publicKey(),
  };
}

export function verifyAuditExportSignature(exported: SignedAuditExport): boolean {
  const canonical = JSON.stringify({
    entries: exported.entries,
    exportedAt: exported.exportedAt,
    entryCount: exported.entryCount,
  });
  const contentHash = createHash("sha256").update(canonical).digest("hex");
  if (contentHash !== exported.contentHash) return false;

  try {
    const signature = Buffer.from(exported.signature, "base64");
    return Keypair.fromPublicKey(exported.signerPublicKey).verifyMessage(
      exported.contentHash,
      signature,
    );
  } catch {
    return false;
  }
}
