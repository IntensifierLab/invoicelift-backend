import { InvoiceStatus, Prisma } from "@prisma/client";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { facilityDeps } from "../../lib/facilityDeps.js";
import { isValidStellarAddress } from "../../lib/stellarSignature.js";
import {
  InvoiceStateError,
  createInvoice,
  getInvoice,
  listInvoiceAuditLog,
  listInvoices,
  submitBuyerSignature,
  submitSmeSignature,
} from "../../services/invoiceVerificationService.js";

const SME_ACTOR = "api:invoice-sme";
const BUYER_ACTOR = "api:invoice-buyer";

const stellarAddress = z.string().refine(isValidStellarAddress, {
  message: "Invalid Stellar address",
});

const createInvoiceSchema = z.object({
  reference: z.string().min(1),
  smeAddress: stellarAddress,
  buyerAddress: stellarAddress,
  amount: z.number().int().positive(),
  currency: z.string().min(1).optional(),
  dueDate: z.coerce.date(),
});

const signatureSchema = z.object({
  signature: z.string().min(1),
});

const listQuerySchema = z.object({
  status: z.nativeEnum(InvoiceStatus).optional(),
});

export const invoiceRoutes: FastifyPluginAsync = async (app) => {
  app.post("/invoices", async (req, reply) => {
    const parsed = createInvoiceSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    try {
      const invoice = await createInvoice(facilityDeps.prisma, parsed.data, SME_ACTOR);
      return reply.status(201).send(invoice);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        return reply.status(409).send({ error: "Invoice reference already exists" });
      }
      throw err;
    }
  });

  app.get("/invoices", async (req, reply) => {
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    return listInvoices(facilityDeps.prisma, parsed.data);
  });

  app.get("/invoices/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const invoice = await getInvoice(facilityDeps.prisma, id);
    if (!invoice) {
      return reply.status(404).send({ error: "Invoice not found" });
    }
    return invoice;
  });

  app.get("/invoices/:id/audit", async (req, reply) => {
    const { id } = req.params as { id: string };
    const invoice = await getInvoice(facilityDeps.prisma, id);
    if (!invoice) {
      return reply.status(404).send({ error: "Invoice not found" });
    }
    return listInvoiceAuditLog(facilityDeps.prisma, id);
  });

  app.post("/invoices/:id/sme-signature", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = signatureSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    const invoice = await getInvoice(facilityDeps.prisma, id);
    if (!invoice) {
      return reply.status(404).send({ error: "Invoice not found" });
    }

    try {
      const result = await submitSmeSignature(
        facilityDeps.prisma,
        id,
        parsed.data.signature,
        SME_ACTOR,
      );
      if (!result.signatureAccepted) {
        return reply.status(400).send({ error: "Invalid SME signature", invoice: result.invoice });
      }
      return reply.status(200).send(result.invoice);
    } catch (err) {
      if (err instanceof InvoiceStateError) {
        return reply.status(409).send({ error: err.message });
      }
      throw err;
    }
  });

  app.post("/invoices/:id/buyer-signature", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = signatureSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    const invoice = await getInvoice(facilityDeps.prisma, id);
    if (!invoice) {
      return reply.status(404).send({ error: "Invoice not found" });
    }

    try {
      const result = await submitBuyerSignature(
        facilityDeps.prisma,
        id,
        parsed.data.signature,
        BUYER_ACTOR,
      );
      if (!result.signatureAccepted) {
        return reply
          .status(400)
          .send({ error: "Invalid or expired buyer signature", invoice: result.invoice });
      }
      return reply.status(200).send(result.invoice);
    } catch (err) {
      if (err instanceof InvoiceStateError) {
        return reply.status(409).send({ error: err.message });
      }
      throw err;
    }
  });
};
