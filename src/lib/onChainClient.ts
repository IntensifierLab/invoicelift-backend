import { createHash } from "node:crypto";
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

export interface OnChainClient {
  confirmDrawdown(input: DrawdownConfirmationInput): Promise<DrawdownConfirmation>;
  createPool(input: CreatePoolOnChainInput): Promise<CreatePoolOnChainResult>;
  createInvoice(input: CreateInvoiceOnChainInput): Promise<CreateInvoiceOnChainResult>;
}

/**
 * Deterministic fake confirmation so the full drawdown flow is runnable and
 * testable without a live Soroban RPC connection or deployed contract.
 */
export class StubOnChainClient implements OnChainClient {
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
}

export function createOnChainClient(): OnChainClient {
  switch (config.onChainClientMode) {
    case "soroban":
      return new SorobanOnChainClient();
    case "stub":
    default:
      return new StubOnChainClient();
  }
}
