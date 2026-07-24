import { beforeEach, describe, expect, it } from "vitest";
import { facilityDeps } from "../../src/lib/facilityDeps.js";
import { generateDidKeypair } from "../../src/lib/did.js";
import { StubKycProvider } from "../../src/lib/kycProvider.js";
import { issueCredentialSigned } from "../../src/lib/verifiableCredential.js";
import {
  InvalidCredentialError,
  RefreshNotNeededError,
  SubjectNotFoundError,
  getLatestCredential,
  issueKyc,
  refreshCredential,
  verifySubmittedCredential,
} from "../../src/services/kycService.js";
import { resetDb } from "../dbHelpers.js";

const prisma = facilityDeps.prisma;

describe("kycService", () => {
  beforeEach(async () => {
    await resetDb(prisma);
  });

  it("issues a credential and stores only metadata, not raw KYC content", async () => {
    const provider = new StubKycProvider();
    const subject = generateDidKeypair();

    const { credential, record } = await issueKyc(prisma, provider, {
      subjectDid: subject.did,
      subjectType: "SME",
    });

    expect(credential.credentialSubject.id).toBe(subject.did);
    expect(record.subjectDid).toBe(subject.did);
    expect(record.status).toBe("VERIFIED");
    expect(record.credentialHash).toHaveLength(64);

    // Only the fields declared on the Prisma model exist — no raw payload column.
    expect(Object.keys(record).sort()).toEqual(
      [
        "id",
        "subjectDid",
        "subjectType",
        "issuerDid",
        "credentialId",
        "status",
        "issuedAt",
        "expiresAt",
        "verifiedAt",
        "credentialHash",
        "createdAt",
        "updatedAt",
      ].sort(),
    );
  });

  it("rejects a credential with a tampered signature", async () => {
    const provider = new StubKycProvider();
    const subject = generateDidKeypair();
    const { credential } = await issueKyc(prisma, provider, {
      subjectDid: subject.did,
      subjectType: "LENDER",
    });

    const tampered = { ...credential, credentialSubject: { ...credential.credentialSubject, id: "did:key:zHACKED" } };

    await expect(verifySubmittedCredential(prisma, tampered)).rejects.toBeInstanceOf(
      InvalidCredentialError,
    );
  });

  it("rejects an expired credential", async () => {
    const issuer = generateDidKeypair();
    const subject = generateDidKeypair();
    const expired = issueCredentialSigned({
      issuerDid: issuer.did,
      issuerPrivateKey: issuer.privateKey,
      subjectDid: subject.did,
      subjectType: "SME",
      validityDays: -1,
    });

    await expect(verifySubmittedCredential(prisma, expired)).rejects.toBeInstanceOf(
      InvalidCredentialError,
    );
  });

  it("verifies and stores a credential submitted independently of the issue endpoint", async () => {
    const issuer = generateDidKeypair();
    const subject = generateDidKeypair();
    const credential = issueCredentialSigned({
      issuerDid: issuer.did,
      issuerPrivateKey: issuer.privateKey,
      subjectDid: subject.did,
      subjectType: "LENDER",
      validityDays: 30,
    });

    const record = await verifySubmittedCredential(prisma, credential);
    expect(record.issuerDid).toBe(issuer.did);

    const latest = await getLatestCredential(prisma, subject.did);
    expect(latest?.credentialId).toBe(credential.id);
  });

  it("throws SubjectNotFoundError when refreshing an unknown subject", async () => {
    await expect(
      refreshCredential(prisma, new StubKycProvider(), "did:key:zdoesnotexist"),
    ).rejects.toBeInstanceOf(SubjectNotFoundError);
  });

  it("refuses to refresh a credential that is not near expiry", async () => {
    const provider = new StubKycProvider();
    const subject = generateDidKeypair();
    await issueKyc(prisma, provider, { subjectDid: subject.did, subjectType: "SME" });

    await expect(refreshCredential(prisma, provider, subject.did)).rejects.toBeInstanceOf(
      RefreshNotNeededError,
    );
  });

  it("reissues a credential when the existing one is expired", async () => {
    const provider = new StubKycProvider();
    const issuer = generateDidKeypair();
    const subject = generateDidKeypair();

    // Seed an already-expired record directly (bypassing the 365-day default).
    const expiredCredential = issueCredentialSigned({
      issuerDid: issuer.did,
      issuerPrivateKey: issuer.privateKey,
      subjectDid: subject.did,
      subjectType: "SME",
      validityDays: -1,
    });
    await prisma.kycCredential.create({
      data: {
        subjectDid: subject.did,
        subjectType: "SME",
        issuerDid: issuer.did,
        credentialId: expiredCredential.id,
        status: "VERIFIED",
        issuedAt: new Date(expiredCredential.issuanceDate),
        expiresAt: new Date(expiredCredential.expirationDate),
        credentialHash: "seed-hash",
      },
    });

    const result = await refreshCredential(prisma, provider, subject.did);
    expect(result.credential.credentialSubject.id).toBe(subject.did);

    const old = await prisma.kycCredential.findUnique({
      where: { credentialId: expiredCredential.id },
    });
    expect(old?.status).toBe("EXPIRED");

    const latest = await getLatestCredential(prisma, subject.did);
    expect(latest?.status).toBe("VERIFIED");
    expect(latest?.credentialId).not.toBe(expiredCredential.id);
  });
});
