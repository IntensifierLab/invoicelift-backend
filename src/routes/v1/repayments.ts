import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

const submitRepaymentSchema = z.object({
  invoiceId: z.string().min(1),
  amount: z.number().positive(),
  buyerAddress: z.string().min(1),
  poolId: z.string().min(1),
});

const confirmRepaymentSchema = z.object({
  txHash: z.string().min(1),
});

type SubmitRepaymentInput = z.infer<typeof submitRepaymentSchema>;
type ConfirmRepaymentInput = z.infer<typeof confirmRepaymentSchema>;

interface Repayment {
  id: string;
  invoiceId: string;
  amount: number;
  buyerAddress: string;
  poolId: string;
  idempotencyKey: string;
  status: "pending" | "submitted" | "confirmed" | "failed";
  xdr?: string;
  txHash?: string;
  createdAt: string;
  updatedAt: string;
}

const repayments = new Map<string, Repayment>();

function generateId(): string {
  return `rep_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export const repaymentRoutes: FastifyPluginAsync = async (app) => {
  app.post<{
    Body: SubmitRepaymentInput & { idempotencyKey: string };
  }>("/repayments", async (request, reply) => {
    const { idempotencyKey, ...body } = request.body;

    if (!idempotencyKey || idempotencyKey.length < 1) {
      return reply.status(400).send({
        error: "idempotencyKey is required",
      });
    }

    const existing = Array.from(repayments.values()).find(
      (r) => r.idempotencyKey === idempotencyKey,
    );
    if (existing) {
      return reply.status(200).send(existing);
    }

    const parsed = submitRepaymentSchema.safeParse(body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "Validation failed",
        details: parsed.error.flatten().fieldErrors,
      });
    }

    const id = generateId();
    const now = new Date().toISOString();

    const repayment: Repayment = {
      id,
      ...parsed.data,
      idempotencyKey,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    };

    repayments.set(id, repayment);

    const xdr = buildWaterfallXdr(parsed.data);

    repayment.status = "submitted";
    repayment.xdr = xdr;
    repayment.updatedAt = new Date().toISOString();

    return reply.status(201).send({
      id: repayment.id,
      invoiceId: repayment.invoiceId,
      amount: repayment.amount,
      buyerAddress: repayment.buyerAddress,
      poolId: repayment.poolId,
      status: repayment.status,
      xdr,
      createdAt: repayment.createdAt,
    });
  });

  app.post<{
    Params: { id: string };
    Body: ConfirmRepaymentInput;
  }>("/repayments/:id/confirm", async (request, reply) => {
    const { id } = request.params;
    const parsed = confirmRepaymentSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.status(400).send({
        error: "Validation failed",
        details: parsed.error.flatten().fieldErrors,
      });
    }

    const repayment = repayments.get(id);
    if (!repayment) {
      return reply.status(404).send({
        error: "Repayment not found",
      });
    }

    if (repayment.status === "confirmed") {
      return reply.status(200).send(repayment);
    }

    if (repayment.status !== "submitted") {
      return reply.status(409).send({
        error: `Cannot confirm repayment in ${repayment.status} status`,
      });
    }

    const onChainVerified = await verifyOnChainInclusion(parsed.data.txHash);

    if (!onChainVerified) {
      return reply.status(400).send({
        error: "Transaction not found on-chain or not yet confirmed",
      });
    }

    repayment.status = "confirmed";
    repayment.txHash = parsed.data.txHash;
    repayment.updatedAt = new Date().toISOString();

    await triggerWaterfallDistribution(repayment);

    return reply.status(200).send({
      id: repayment.id,
      invoiceId: repayment.invoiceId,
      amount: repayment.amount,
      buyerAddress: repayment.buyerAddress,
      poolId: repayment.poolId,
      status: repayment.status,
      txHash: repayment.txHash,
      createdAt: repayment.createdAt,
      updatedAt: repayment.updatedAt,
    });
  });
};

function buildWaterfallXdr(data: SubmitRepaymentInput): string {
  return `simulate_waterfall_xdr_${data.poolId}_${data.amount}_${Date.now()}`;
}

async function verifyOnChainInclusion(_txHash: string): Promise<boolean> {
  return true;
}

async function triggerWaterfallDistribution(_repayment: Repayment): Promise<void> {
  // TODO: implement actual Soroban contract invocation
}
