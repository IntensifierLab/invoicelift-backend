import type { FastifyInstance } from "fastify";
import { Keypair } from "@stellar/stellar-sdk";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { facilityDeps } from "../../src/lib/facilityDeps.js";
import { buildServer } from "../../src/server.js";
import { resetDb } from "../dbHelpers.js";

describe("invoice routes", () => {
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
    const sme = Keypair.random();
    const buyer = Keypair.random();

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/invoices",
      payload: {
        reference,
        smeAddress: sme.publicKey(),
        buyerAddress: buyer.publicKey(),
        amount: 10_000,
        currency: "USD",
        dueDate: "2026-12-31T00:00:00.000Z",
      },
    });

    return { res, invoice: res.json(), sme, buyer };
  }

  it("creates and fetches an invoice via HTTP", async () => {
    const { res, invoice } = await createInvoiceViaHttp("http-basic");
    expect(res.statusCode).toBe(201);
    expect(invoice.status).toBe("PENDING_SME_SIGNATURE");

    const getRes = await app.inject({ method: "GET", url: `/api/v1/invoices/${invoice.id}` });
    expect(getRes.statusCode).toBe(200);
    expect(getRes.json().id).toBe(invoice.id);
  });

  it("returns 400 for an invalid invoice payload", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/invoices",
      payload: { reference: "bad", smeAddress: "not-a-stellar-address" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 404 for an unknown invoice id", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/invoices/does-not-exist" });
    expect(res.statusCode).toBe(404);
  });

  it("rejects a buyer signature submitted before the SME signs (409)", async () => {
    const { invoice, buyer } = await createInvoiceViaHttp("http-buyer-first");
    const signature = buyer.signMessage(invoice.invoiceHash).toString("base64");

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/invoices/${invoice.id}/buyer-signature`,
      payload: { signature },
    });

    expect(res.statusCode).toBe(409);
  });

  it("returns 400 and leaves the invoice unchanged on an invalid SME signature", async () => {
    const { invoice } = await createInvoiceViaHttp("http-sme-invalid");
    const wrongKeypair = Keypair.random();
    const signature = wrongKeypair.signMessage(invoice.invoiceHash).toString("base64");

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/invoices/${invoice.id}/sme-signature`,
      payload: { signature },
    });

    expect(res.statusCode).toBe(400);

    const getRes = await app.inject({ method: "GET", url: `/api/v1/invoices/${invoice.id}` });
    expect(getRes.json().status).toBe("PENDING_SME_SIGNATURE");
  });

  it("completes the full SME-then-buyer signature flow and records the audit trail", async () => {
    const { invoice, sme, buyer } = await createInvoiceViaHttp("http-full-flow");

    const smeSignature = sme.signMessage(invoice.invoiceHash).toString("base64");
    const smeRes = await app.inject({
      method: "POST",
      url: `/api/v1/invoices/${invoice.id}/sme-signature`,
      payload: { signature: smeSignature },
    });
    expect(smeRes.statusCode).toBe(200);
    expect(smeRes.json().status).toBe("PENDING_BUYER_SIGNATURE");

    const buyerSignature = buyer.signMessage(invoice.invoiceHash).toString("base64");
    const buyerRes = await app.inject({
      method: "POST",
      url: `/api/v1/invoices/${invoice.id}/buyer-signature`,
      payload: { signature: buyerSignature },
    });
    expect(buyerRes.statusCode).toBe(200);
    expect(buyerRes.json().status).toBe("VERIFIED");

    const auditRes = await app.inject({
      method: "GET",
      url: `/api/v1/invoices/${invoice.id}/audit`,
    });
    expect(auditRes.statusCode).toBe(200);
    const actions = auditRes.json().map((entry: { action: string }) => entry.action);
    expect(actions).toEqual([
      "INVOICE_CREATED",
      "SME_SIGNATURE_VERIFIED",
      "BUYER_SIGNATURE_VERIFIED",
      "VERIFICATION_COMPLETED",
    ]);
  });

  it("filters the invoice list by status", async () => {
    await createInvoiceViaHttp("http-list-a");
    const { invoice, sme } = await createInvoiceViaHttp("http-list-b");
    await app.inject({
      method: "POST",
      url: `/api/v1/invoices/${invoice.id}/sme-signature`,
      payload: { signature: sme.signMessage(invoice.invoiceHash).toString("base64") },
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/invoices?status=PENDING_BUYER_SIGNATURE",
    });
    expect(res.statusCode).toBe(200);
    const list = res.json();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(invoice.id);
  });
});
