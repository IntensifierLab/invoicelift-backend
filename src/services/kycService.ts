import type { KycCredential, PrismaClient } from "@prisma/client";
import { config } from "../config/env.js";
import type { IssueCredentialInput, KycProvider } from "../lib/kycProvider.js";
import { hashCredential, verifyCredential, type VerifiableCredential } from "../lib/verifiableCredential.js";

export class InvalidCredentialError extends Error {
  constructor(reason?: string) {
    super(`Credential failed verification${reason ? `: ${reason}` : ""}`);
    this.name = "InvalidCredentialError";
  }
}

export class SubjectNotFoundError extends Error {
  constructor(subjectDid: string) {
    super(`No KYC credential found for subject "${subjectDid}"`);
    this.name = "SubjectNotFoundError";
  }
}

export class RefreshNotNeededError extends Error {
  constructor(subjectDid: string) {
    super(`Existing credential for "${subjectDid}" is still valid and not near expiry`);
    this.name = "RefreshNotNeededError";
  }
}

/**
 * Verifies the credential's signature/expiry, then persists only metadata —
 * subject DID, issuer, validity window, status, and a hash of the
 * credential — never the raw KYC content behind it (there is none to leak
 * by construction: this backend never receives it).
 */
async function storeVerifiedCredential(
  prisma: PrismaClient,
  vc: VerifiableCredential,
): Promise<KycCredential> {
  const verification = verifyCredential(vc);
  if (!verification.valid) {
    throw new InvalidCredentialError(verification.reason);
  }

  return prisma.kycCredential.upsert({
    where: { credentialId: vc.id },
    update: {
      status: "VERIFIED",
      verifiedAt: new Date(),
      credentialHash: hashCredential(vc),
      expiresAt: new Date(vc.expirationDate),
    },
    create: {
      subjectDid: vc.credentialSubject.id,
      subjectType: vc.credentialSubject.type,
      issuerDid: vc.issuer,
      credentialId: vc.id,
      status: "VERIFIED",
      issuedAt: new Date(vc.issuanceDate),
      expiresAt: new Date(vc.expirationDate),
      credentialHash: hashCredential(vc),
    },
  });
}

export interface IssueKycResult {
  credential: VerifiableCredential;
  record: KycCredential;
}

export async function issueKyc(
  prisma: PrismaClient,
  provider: KycProvider,
  input: IssueCredentialInput,
): Promise<IssueKycResult> {
  const credential = await provider.issueCredential(input);
  const record = await storeVerifiedCredential(prisma, credential);
  return { credential, record };
}

export async function verifySubmittedCredential(
  prisma: PrismaClient,
  credential: VerifiableCredential,
): Promise<KycCredential> {
  return storeVerifiedCredential(prisma, credential);
}

export async function getLatestCredential(
  prisma: PrismaClient,
  subjectDid: string,
): Promise<KycCredential | null> {
  return prisma.kycCredential.findFirst({
    where: { subjectDid },
    orderBy: { issuedAt: "desc" },
  });
}

/**
 * Reissues a credential for `subjectDid` when the existing one is expired or
 * within the configured refresh window. The stale record (if expired) is
 * marked EXPIRED, then a fresh credential is issued and stored.
 */
export async function refreshCredential(
  prisma: PrismaClient,
  provider: KycProvider,
  subjectDid: string,
): Promise<IssueKycResult> {
  const existing = await getLatestCredential(prisma, subjectDid);
  if (!existing) {
    throw new SubjectNotFoundError(subjectDid);
  }

  const refreshWindowMs = config.kycRefreshWindowDays * 24 * 60 * 60 * 1000;
  const msUntilExpiry = existing.expiresAt.getTime() - Date.now();
  const isExpired = msUntilExpiry <= 0;
  const nearExpiry = msUntilExpiry <= refreshWindowMs;

  if (existing.status === "VERIFIED" && !isExpired && !nearExpiry) {
    throw new RefreshNotNeededError(subjectDid);
  }

  if (isExpired && existing.status === "VERIFIED") {
    await prisma.kycCredential.update({ where: { id: existing.id }, data: { status: "EXPIRED" } });
  }

  return issueKyc(prisma, provider, {
    subjectDid,
    subjectType: existing.subjectType as "SME" | "LENDER",
  });
}
