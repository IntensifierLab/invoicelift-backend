import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { config } from "../config/env.js";

export interface DrawdownConfirmationInput {
  poolId: string;
  drawdownId: string;
  amount: number;
}

export interface DrawdownConfirmation {
  txHash: string;
  confirmedAt: Date;
  raw?: unknown;
}

export interface CreatePoolOnChainInput {
  poolId: string;
  totalCapital: number;
}

export interface CreatePoolOnChainResult {
  txHash: string;
  confirmedAt: Date;
  raw?: unknown;
}

export interface CreateInvoiceOnChainInput {
  invoiceId: string;
  invoiceHash: string;
  smeAddress: string;
  buyerAddress: string;
  amount: number;
}

export interface CreateInvoiceOnChainResult {
  txHash: string;
  confirmedAt: Date;
  raw?: unknown;
}

export interface LedgerSnapshot {
  invoiceCount: number;
  poolTvl: number;
  repaymentTotal: number;
}

export interface OnChainClient {
  confirmDrawdown(input: DrawdownConfirmationInput): Promise<DrawdownConfirmation>;
  createPool(input: CreatePoolOnChainInput): Promise<CreatePoolOnChainResult>;
  createInvoice(input: CreateInvoiceOnChainInput): Promise<CreateInvoiceOnChainResult>;
  /** Aggregate on-chain state for reconciliation against the local DB. See reconciliation.ts. */
  getLedgerSnapshot(): Promise<LedgerSnapshot>;
}

/**
 * Deterministic fake confirmation so the full drawdown flow is runnable and
 * testable without a live Soroban RPC connection or deployed contract.
 */
export class StubOnChainClient implements OnChainClient {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * No real chain exists yet, so there is no independent second source to
   * read from. Echoing the DB's own aggregates (zero drift by default) is
   * the honest stub behaviour — it exercises the full reconciliation path
   * (see reconciliation.ts) without fabricating discrepancies. Tests that
   * need to exercise the discrepancy/self-heal paths construct their own
   * fake OnChainClient with deliberately injected drift instead of relying
   * on this stub.
   */
  async getLedgerSnapshot(): Promise<LedgerSnapshot> {
    const [invoiceCount, pools, confirmedDrawdowns] = await Promise.all([
      this.prisma.invoice.count(),
      this.prisma.pool.findMany({ select: { totalCapital: true } }),
      this.prisma.capitalDrawdown.findMany({
        where: { status: "CONFIRMED" },
        select: { amountRequested: true },
      }),
    ]);

    return {
      invoiceCount,
      poolTvl: pools.reduce((sum, p) => sum + p.totalCapital, 0),
      repaymentTotal: confirmedDrawdowns.reduce((sum, d) => sum + d.amountRequested, 0),
    };
  }

  async confirmDrawdown(input: DrawdownConfirmationInput): Promise<DrawdownConfirmation> {
    const txHash = createHash("sha256")
      .update(`${input.poolId}:${input.drawdownId}:${input.amount}`)
      .digest("hex");

    return {
      txHash: `stub_${txHash}`,
      confirmedAt: new Date(),
      raw: { mode: "stub", ...input },
    };
  }

  async createPool(input: CreatePoolOnChainInput): Promise<CreatePoolOnChainResult> {
    const txHash = createHash("sha256")
      .update(`create-pool:${input.poolId}:${input.totalCapital}`)
      .digest("hex");

    return {
      txHash: `stub_${txHash}`,
      confirmedAt: new Date(),
      raw: { mode: "stub", ...input },
    };
  }

  async createInvoice(input: CreateInvoiceOnChainInput): Promise<CreateInvoiceOnChainResult> {
    const txHash = createHash("sha256")
      .update(`create-invoice:${input.invoiceId}:${input.invoiceHash}`)
      .digest("hex");

    return {
      txHash: `stub_${txHash}`,
      confirmedAt: new Date(),
      raw: { mode: "stub", ...input },
    };
  }
}

export class SorobanOnChainClient implements OnChainClient {
  async confirmDrawdown(): Promise<DrawdownConfirmation> {
    throw new Error(
      "SorobanOnChainClient is not implemented yet — set ONCHAIN_CLIENT_MODE=stub, or implement Soroban RPC integration before enabling this mode.",
    );
  }

  async createPool(): Promise<CreatePoolOnChainResult> {
    throw new Error(
      "SorobanOnChainClient is not implemented yet — set ONCHAIN_CLIENT_MODE=stub, or implement Soroban RPC integration before enabling this mode.",
    );
  }

  async createInvoice(): Promise<CreateInvoiceOnChainResult> {
    throw new Error(
      "SorobanOnChainClient is not implemented yet — set ONCHAIN_CLIENT_MODE=stub, or implement Soroban RPC integration before enabling this mode.",
    );
  }

  async getLedgerSnapshot(): Promise<LedgerSnapshot> {
    throw new Error(
      "SorobanOnChainClient is not implemented yet — set ONCHAIN_CLIENT_MODE=stub, or implement Soroban RPC integration before enabling this mode.",
    );
  }
}

export function createOnChainClient(prisma: PrismaClient): OnChainClient {
  switch (config.onChainClientMode) {
    case "soroban":
      return new SorobanOnChainClient();
    case "stub":
    default:
      return new StubOnChainClient(prisma);
  }
}
