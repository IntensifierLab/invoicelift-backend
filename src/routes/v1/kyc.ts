import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { generateDidKeypair } from "../../lib/did.js";
import { facilityDeps } from "../../lib/facilityDeps.js";
import { createKycProvider } from "../../lib/kycProvider.js";
import {
  InvalidCredentialError,
  RefreshNotNeededError,
  SubjectNotFoundError,
  getLatestCredential,
  issueKyc,
  refreshCredential,
  verifySubmittedCredential,
} from "../../services/kycService.js";

const kycProvider = createKycProvider();

const issueSchema = z.object({
  subjectDid: z.string().min(1).optional(),
  subjectType: z.enum(["SME", "LENDER"]),
});

// Minimal structural check — the real validation (signature, issuer match,
// expiry) happens in verifyCredential.
const verifiableCredentialSchema = z.object({
  "@context": z.array(z.string()),
  id: z.string(),
  type: z.array(z.string()),
  issuer: z.string(),
  issuanceDate: z.string(),
  expirationDate: z.string(),
  credentialSubject: z.object({ id: z.string(), type: z.enum(["SME", "LENDER"]) }),
  proof: z.object({
    type: z.string(),
    created: z.string(),
    verificationMethod: z.string(),
    proofPurpose: z.string(),
    proofValue: z.string(),
  }),
});

const verifySchema = z.object({ credential: verifiableCredentialSchema });
const refreshSchema = z.object({ subjectDid: z.string().min(1) });

export const kycRoutes: FastifyPluginAsync = async (app) => {
  app.post("/kyc/issue", async (req, reply) => {
    const parsed = issueSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    // A real subject supplies their own DID (their wallet holds the private
    // key). Minting one here is a dev/test convenience for callers that
    // don't have one yet.
    const subjectDid = parsed.data.subjectDid ?? generateDidKeypair().did;

    const result = await issueKyc(facilityDeps.prisma, kycProvider, {
      subjectDid,
      subjectType: parsed.data.subjectType,
    });
    return reply.status(201).send(result);
  });

  app.post("/kyc/verify", async (req, reply) => {
    const parsed = verifySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    try {
      return await verifySubmittedCredential(facilityDeps.prisma, parsed.data.credential);
    } catch (err) {
      if (err instanceof InvalidCredentialError) {
        return reply.status(400).send({ error: err.message });
      }
      throw err;
    }
  });

  app.get("/kyc/:subjectDid", async (req, reply) => {
    const { subjectDid } = req.params as { subjectDid: string };
    const record = await getLatestCredential(facilityDeps.prisma, subjectDid);
    if (!record) {
      return reply.status(404).send({ error: "No KYC credential found for subject" });
    }
    return record;
  });

  app.post("/kyc/refresh", async (req, reply) => {
    const parsed = refreshSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    try {
      return await refreshCredential(facilityDeps.prisma, kycProvider, parsed.data.subjectDid);
    } catch (err) {
      if (err instanceof SubjectNotFoundError) {
        return reply.status(404).send({ error: err.message });
      }
      if (err instanceof RefreshNotNeededError) {
        return reply.status(409).send({ error: err.message });
      }
      throw err;
    }
  });
};
