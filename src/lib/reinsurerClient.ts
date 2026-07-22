import { randomUUID } from "node:crypto";
import { config } from "../config/env.js";

export interface CapitalRequestInput {
  treatyId: string;
  poolId: string;
  amountRequested: number;
  triggerReason: string;
}

export interface CapitalRequestResult {
  reinsurerRequestId: string;
  approved: boolean;
  amountApproved: number;
  raw?: unknown;
}

export interface ReinsurerClient {
  requestCapital(input: CapitalRequestInput): Promise<CapitalRequestResult>;
}

/**
 * Always-approves stub so the drawdown flow is runnable and testable without
 * a real reinsurer counterparty or endpoint.
 */
export class StubReinsurerClient implements ReinsurerClient {
  async requestCapital(input: CapitalRequestInput): Promise<CapitalRequestResult> {
    return {
      reinsurerRequestId: `stub_${randomUUID()}`,
      approved: true,
      amountApproved: input.amountRequested,
      raw: { mode: "stub", ...input },
    };
  }
}

export class HttpReinsurerClient implements ReinsurerClient {
  async requestCapital(input: CapitalRequestInput): Promise<CapitalRequestResult> {
    if (!config.reinsurerApiUrl) {
      throw new Error("REINSURER_API_URL must be set when REINSURER_CLIENT_MODE=http");
    }

    const response = await fetch(config.reinsurerApiUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(config.reinsurerApiKey
          ? { authorization: `Bearer ${config.reinsurerApiKey}` }
          : {}),
      },
      body: JSON.stringify(input),
    });

    if (!response.ok) {
      throw new Error(`Reinsurer API request failed with status ${response.status}`);
    }

    const raw = (await response.json()) as {
      requestId: string;
      approved: boolean;
      amountApproved: number;
    };

    return {
      reinsurerRequestId: raw.requestId,
      approved: raw.approved,
      amountApproved: raw.amountApproved,
      raw,
    };
  }
}

export function createReinsurerClient(): ReinsurerClient {
  switch (config.reinsurerClientMode) {
    case "http":
      return new HttpReinsurerClient();
    case "stub":
    default:
      return new StubReinsurerClient();
  }
}
