import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { generateDidKeypair } from "../../src/lib/did.js";
import { facilityDeps } from "../../src/lib/facilityDeps.js";
import { buildServer } from "../../src/server.js";
import { resetDb } from "../dbHelpers.js";

describe("kyc routes", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildServer();
  });

  beforeEach(async () => {
    await resetDb(facilityDeps.prisma);
  });

  afterAll(async () => {
    await app.close();
  });

  it("issues a credential, generating a subject DID when none is supplied", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/kyc/issue",
      payload: { subjectType: "SME" },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.credential.credentialSubject.id).toMatch(/^did:key:z/);
    expect(body.record.status).toBe("VERIFIED");
  });

  it("fetches the latest credential for a subject", async () => {
    const issueRes = await app.inject({
      method: "POST",
      url: "/api/v1/kyc/issue",
      payload: { subjectType: "LENDER" },
    });
    const subjectDid = issueRes.json().record.subjectDid;

    const getRes = await app.inject({
      method: "GET",
      url: `/api/v1/kyc/${encodeURIComponent(subjectDid)}`,
    });
    expect(getRes.statusCode).toBe(200);
    expect(getRes.json().subjectDid).toBe(subjectDid);
  });

  it("returns 404 for an unknown subject", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/kyc/did:key:zunknown" });
    expect(res.statusCode).toBe(404);
  });

  it("verifies an externally-issued credential without a prior issue call", async () => {
    const subject = generateDidKeypair();
    const issueRes = await app.inject({
      method: "POST",
      url: "/api/v1/kyc/issue",
      payload: { subjectDid: subject.did, subjectType: "SME" },
    });
    const credential = issueRes.json().credential;

    const verifyRes = await app.inject({
      method: "POST",
      url: "/api/v1/kyc/verify",
      payload: { credential },
    });
    expect(verifyRes.statusCode).toBe(200);
  });

  it("returns 400 when verifying a tampered credential", async () => {
    const subject = generateDidKeypair();
    const issueRes = await app.inject({
      method: "POST",
      url: "/api/v1/kyc/issue",
      payload: { subjectDid: subject.did, subjectType: "SME" },
    });
    const credential = issueRes.json().credential;
    credential.proof.proofValue = "tampered";

    const verifyRes = await app.inject({
      method: "POST",
      url: "/api/v1/kyc/verify",
      payload: { credential },
    });
    expect(verifyRes.statusCode).toBe(400);
  });

  it("returns 409 when refreshing a credential that is not near expiry", async () => {
    const issueRes = await app.inject({
      method: "POST",
      url: "/api/v1/kyc/issue",
      payload: { subjectType: "SME" },
    });
    const subjectDid = issueRes.json().record.subjectDid;

    const refreshRes = await app.inject({
      method: "POST",
      url: "/api/v1/kyc/refresh",
      payload: { subjectDid },
    });
    expect(refreshRes.statusCode).toBe(409);
  });

  it("returns 404 when refreshing an unknown subject", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/kyc/refresh",
      payload: { subjectDid: "did:key:zunknown" },
    });
    expect(res.statusCode).toBe(404);
  });
});
