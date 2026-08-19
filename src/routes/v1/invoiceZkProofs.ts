import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { facilityDeps } from "../../lib/facilityDeps.js";
import { isWellFormedProof } from "../../lib/zkInvoiceProof.js";

const submitProofSchema = z.object({
  commitment: z.string().regex(/^[0-9a-f]{64}$/i),
  nullifier: z.string().regex(/^[0-9a-f]{64}$/i),
});

/**
 * Backend never receives, requests, or stores raw invoice identifying
 * fields here — only the client-computed commitment/nullifier pair (see
 * zkInvoiceProof.ts). "On-chain" linkage is a deterministic stub hash,
 * matching this codebase's existing StubOnChainClient pattern, kept
 * self-contained here rather than routed through OnChainClient to avoid
 * widening this PR's surface into a file another in-flight PR also edits.
 */
export const invoiceZkProofRoutes: FastifyPluginAsync = async (app) => {
  app.post("/invoices/:invoiceId/zk-attestation", async (req, reply) => {
    const { invoiceId } = req.params as { invoiceId: string };
    const parsed = submitProofSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }
    if (!isWellFormedProof(parsed.data)) {
      return reply.status(400).send({ error: "malformed proof" });
    }

    const invoice = await facilityDeps.prisma.invoice.findUnique({ where: { id: invoiceId } });
    if (!invoice) {
      return reply.status(404).send({ error: "invoice not found" });
    }

    const stubTxHash = createHash("sha256")
      .update(`zk-attest:${invoiceId}:${parsed.data.nullifier}`)
      .digest("hex");

    try {
      const attestation = await facilityDeps.prisma.invoiceZkAttestation.create({
        data: {
          invoiceId,
          commitment: parsed.data.commitment,
          nullifier: parsed.data.nullifier,
          onChainTxHash: `stub_${stubTxHash}`,
          onChainConfirmedAt: new Date(),
        },
      });
      return reply.status(201).send(attestation);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        return reply
          .status(409)
          .send({ error: "this invoice has already been attested (duplicate nullifier)" });
      }
      throw err;
    }
  });

  app.get("/invoices/:invoiceId/zk-attestations", async (req) => {
    const { invoiceId } = req.params as { invoiceId: string };
    return facilityDeps.prisma.invoiceZkAttestation.findMany({
      where: { invoiceId },
      orderBy: { createdAt: "desc" },
    });
  });
};
