import { createHash, randomUUID, type KeyObject } from "node:crypto";
import { signWithDidKey, verifyWithDid } from "./did.js";

export type KycSubjectType = "SME" | "LENDER";

export interface VerifiableCredential {
  "@context": string[];
  id: string;
  type: string[];
  issuer: string;
  issuanceDate: string;
  expirationDate: string;
  credentialSubject: {
    id: string;
    type: KycSubjectType;
  };
  proof: {
    type: string;
    created: string;
    verificationMethod: string;
    proofPurpose: string;
    proofValue: string;
  };
}

/** Deterministic JSON serialization (recursively sorted object keys) so signing and verification always hash the same bytes. */
function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const entries = Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`);
  return `{${entries.join(",")}}`;
}

function credentialPayload(vc: Omit<VerifiableCredential, "proof">): Buffer {
  return Buffer.from(canonicalize(vc));
}

export interface IssueCredentialParams {
  issuerDid: string;
  issuerPrivateKey: KeyObject;
  subjectDid: string;
  subjectType: KycSubjectType;
  validityDays: number;
}

/**
 * Issues a W3C-VC-shaped credential signed with the issuer's did:key. The
 * "trusted KYC provider" is whoever holds `issuerPrivateKey`; this backend
 * never sees or stores the underlying KYC documents that provider checked —
 * only this credential, and only its metadata (see kycService).
 */
export function issueCredentialSigned(params: IssueCredentialParams): VerifiableCredential {
  const now = new Date();
  const expires = new Date(now.getTime() + params.validityDays * 24 * 60 * 60 * 1000);

  const unsigned: Omit<VerifiableCredential, "proof"> = {
    "@context": ["https://www.w3.org/2018/credentials/v1"],
    id: `urn:uuid:${randomUUID()}`,
    type: ["VerifiableCredential", "KycCredential"],
    issuer: params.issuerDid,
    issuanceDate: now.toISOString(),
    expirationDate: expires.toISOString(),
    credentialSubject: { id: params.subjectDid, type: params.subjectType },
  };

  const proofValue = signWithDidKey(params.issuerPrivateKey, credentialPayload(unsigned));

  return {
    ...unsigned,
    proof: {
      type: "Ed25519Signature2020",
      created: now.toISOString(),
      verificationMethod: params.issuerDid,
      proofPurpose: "assertionMethod",
      proofValue,
    },
  };
}

export interface VerificationResult {
  valid: boolean;
  reason?: string;
}

/**
 * Verifies a credential's signature and expiry without any network call or
 * external registry — did:key resolution is purely local (see lib/did.ts).
 */
export function verifyCredential(vc: VerifiableCredential): VerificationResult {
  const { proof, ...unsigned } = vc;
  if (!proof?.verificationMethod || !proof.proofValue) {
    return { valid: false, reason: "Missing proof" };
  }

  if (proof.verificationMethod !== vc.issuer) {
    return { valid: false, reason: "Proof verificationMethod does not match issuer" };
  }

  const signatureValid = verifyWithDid(
    proof.verificationMethod,
    credentialPayload(unsigned),
    proof.proofValue,
  );
  if (!signatureValid) {
    return { valid: false, reason: "Invalid signature" };
  }

  const expiresAt = new Date(vc.expirationDate);
  if (Number.isNaN(expiresAt.getTime())) {
    return { valid: false, reason: "Invalid expirationDate" };
  }
  if (expiresAt.getTime() < Date.now()) {
    return { valid: false, reason: "Credential expired" };
  }

  return { valid: true };
}

export function hashCredential(vc: VerifiableCredential): string {
  return createHash("sha256").update(canonicalize(vc)).digest("hex");
}
