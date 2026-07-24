import { config } from "../config/env.js";
import { generateDidKeypair } from "./did.js";
import { issueCredentialSigned, type KycSubjectType, type VerifiableCredential } from "./verifiableCredential.js";

export interface IssueCredentialInput {
  subjectDid: string;
  subjectType: KycSubjectType;
}

export interface KycProvider {
  readonly issuerDid: string;
  issueCredential(input: IssueCredentialInput): Promise<VerifiableCredential>;
}

/**
 * Simulates a trusted external KYC provider: mints its own did:key identity
 * at process start and signs credentials with it, so the full issue ->
 * verify loop is runnable and testable without a live third-party
 * integration. Swap for a real provider client behind this same interface
 * when one exists.
 */
export class StubKycProvider implements KycProvider {
  private readonly keypair = generateDidKeypair();
  readonly issuerDid = this.keypair.did;

  async issueCredential(input: IssueCredentialInput): Promise<VerifiableCredential> {
    return issueCredentialSigned({
      issuerDid: this.issuerDid,
      issuerPrivateKey: this.keypair.privateKey,
      subjectDid: input.subjectDid,
      subjectType: input.subjectType,
      validityDays: config.kycCredentialValidityDays,
    });
  }
}

export function createKycProvider(): KycProvider {
  switch (config.kycProviderMode) {
    case "stub":
    default:
      return new StubKycProvider();
  }
}
