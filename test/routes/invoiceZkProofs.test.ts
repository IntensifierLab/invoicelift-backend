import type { FastifyInstance } from "fastify";
import { Keypair } from "@stellar/stellar-sdk";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { facilityDeps } from "../../src/lib/facilityDeps.js";
import { buildServer } from "../../src/server.js";
import { generateInvoiceUniquenessProof } from "../../src/lib/zkInvoiceProof.js";
import { resetDb } from "../dbHelpers.js";

describe("invoice zk proof routes", () => {
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

  async function createInvoiceViaHttp(reference: string) {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/invoices",
      payload: {
        reference,
        smeAddress: Keypair.random().publicKey(),
        buyerAddress: Keypair.random().publicKey(),
        amount: 5_000,
        currency: "USD",
        dueDate: "2026-12-31T00:00:00.000Z",
      },
    });
    return res.json();
  }

  it("submits and lists a zk uniqueness attestation for an invoice", async () => {
    const invoice = await createInvoiceViaHttp("zk-inv-1");
    const proof = generateInvoiceUniquenessProof({
      invoiceReference: invoice.reference,
      smeAddress: invoice.smeAddress,
      buyerAddress: invoice.buyerAddress,
      amount: invoice.amount,
      dueDate: invoice.dueDate,
    });

    const submitRes = await app.inject({
      method: "POST",
      url: `/api/v1/invoices/${invoice.id}/zk-attestation`,
      payload: proof,
    });
    expect(submitRes.statusCode).toBe(201);
    const attestation = submitRes.json();
    expect(attestation.commitment).toBe(proof.commitment);
    expect(attestation.onChainTxHash).toMatch(/^stub_/);

    const listRes = await app.inject({
      method: "GET",
      url: `/api/v1/invoices/${invoice.id}/zk-attestations`,
    });
    expect(listRes.statusCode).toBe(200);
    expect(listRes.json()).toHaveLength(1);
  });

  it("rejects a duplicate nullifier (uniqueness proof) with 409, without needing to see raw fields again", async () => {
    const invoiceA = await createInvoiceViaHttp("zk-inv-dup-a");
    const invoiceB = await createInvoiceViaHttp("zk-inv-dup-b");

    const sharedFields = {
      invoiceReference: "SAME-UNDERLYING-INVOICE",
      smeAddress: "SME_X",
      buyerAddress: "BUYER_X",
      amount: 1,
      dueDate: "2026-01-01T00:00:00.000Z",
    };

    const firstProof = generateInvoiceUniquenessProof(sharedFields);
    const firstRes = await app.inject({
      method: "POST",
      url: `/api/v1/invoices/${invoiceA.id}/zk-attestation`,
      payload: firstProof,
    });
    expect(firstRes.statusCode).toBe(201);

    // A different random salt (different commitment) but the SAME
    // underlying fields -> same nullifier -> must be rejected as a
    // duplicate, even though the commitment itself differs.
    const secondProof = generateInvoiceUniquenessProof(sharedFields);
    expect(secondProof.commitment).not.toBe(firstProof.commitment);
    expect(secondProof.nullifier).toBe(firstProof.nullifier);

    const secondRes = await app.inject({
      method: "POST",
      url: `/api/v1/invoices/${invoiceB.id}/zk-attestation`,
      payload: secondProof,
    });
    expect(secondRes.statusCode).toBe(409);
  });

  it("returns 404 when attesting a nonexistent invoice", async () => {
    const proof = generateInvoiceUniquenessProof({
      invoiceReference: "ghost",
      smeAddress: "a",
      buyerAddress: "b",
      amount: 1,
      dueDate: "2026-01-01T00:00:00.000Z",
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/invoices/does-not-exist/zk-attestation",
      payload: proof,
    });
    expect(res.statusCode).toBe(404);
  });

  it("rejects a malformed proof with 400", async () => {
    const invoice = await createInvoiceViaHttp("zk-inv-bad");
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/invoices/${invoice.id}/zk-attestation`,
      payload: { commitment: "not-hex", nullifier: "not-hex" },
    });
    expect(res.statusCode).toBe(400);
  });
});
