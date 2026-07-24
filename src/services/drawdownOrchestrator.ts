import type { CapitalDrawdown, Prisma, PrismaClient, Treaty } from "@prisma/client";
import { config } from "../config/env.js";
import { recordAudit } from "../lib/audit.js";
import type { OnChainClient } from "../lib/onChainClient.js";
import type { PoolStateProvider } from "../lib/poolStateProvider.js";
import type { ReinsurerClient } from "../lib/reinsurerClient.js";

export interface DrawdownOrchestratorDeps {
  prisma: PrismaClient;
  poolStateProvider: PoolStateProvider;
  reinsurerClient: ReinsurerClient;
  onChainClient: OnChainClient;
}

const OUTSTANDING_STATUSES = ["PENDING", "REQUESTED", "CONFIRMED"] as const;

/**
 * Checks a single treaty's pool against its trigger threshold and, on
 * breach, drives the request-capital -> confirm-on-chain flow end to end.
 * Returns null when no breach occurred, and the (possibly failed)
 * CapitalDrawdown record otherwise.
 */
export interface EvaluateAndDrawOptions {
  /** Bypass the trigger-threshold check — used by the manual test-trigger route. */
  force?: boolean;
}

export async function evaluateAndDraw(
  treaty: Treaty,
  deps: DrawdownOrchestratorDeps,
  actor: string,
  options?: EvaluateAndDrawOptions,
): Promise<CapitalDrawdown | null> {
  const { prisma, poolStateProvider, reinsurerClient, onChainClient } = deps;

  const poolState = await poolStateProvider.getPoolState(treaty.poolId);

  await recordAudit(prisma, {
    action: "MONITOR_CHECK_RUN",
    actor,
    treatyId: treaty.id,
    detail: {
      poolId: treaty.poolId,
      utilisationRatio: poolState.utilisationRatio,
      triggerThreshold: treaty.triggerThreshold,
    },
  });

  if (!options?.force && poolState.utilisationRatio < treaty.triggerThreshold) {
    return null;
  }

  const triggerReason = `Pool ${treaty.poolId} utilisation ${poolState.utilisationRatio.toFixed(4)} breached trigger threshold ${treaty.triggerThreshold}`;

  await recordAudit(prisma, {
    action: "THRESHOLD_BREACH_DETECTED",
    actor,
    treatyId: treaty.id,
    detail: { poolId: treaty.poolId, utilisationRatio: poolState.utilisationRatio, triggerReason },
  });

  const outstanding = await prisma.capitalDrawdown.aggregate({
    where: { treatyId: treaty.id, status: { in: [...OUTSTANDING_STATUSES] } },
    _sum: { amountRequested: true },
  });
  const remainingCapacity = treaty.facilityLimit - (outstanding._sum.amountRequested ?? 0);
  const amountRequested = Math.min(
    Math.round(treaty.facilityLimit * config.drawdownRequestPct),
    remainingCapacity,
  );

  if (amountRequested <= 0) {
    return null;
  }

  const drawdown = await prisma.capitalDrawdown.create({
    data: {
      treatyId: treaty.id,
      amountRequested,
      triggerReason,
      status: "PENDING",
    },
  });

  try {
    const capitalRequest = await reinsurerClient.requestCapital({
      treatyId: treaty.id,
      poolId: treaty.poolId,
      amountRequested,
      triggerReason,
    });

    const requested = await prisma.capitalDrawdown.update({
      where: { id: drawdown.id },
      data: {
        status: "REQUESTED",
        reinsurerRequestId: capitalRequest.reinsurerRequestId,
        reinsurerResponse: (capitalRequest.raw ?? null) as Prisma.InputJsonValue,
      },
    });

    await recordAudit(prisma, {
      action: "CAPITAL_REQUESTED",
      actor,
      treatyId: treaty.id,
      drawdownId: drawdown.id,
      detail: { amountRequested, reinsurerRequestId: capitalRequest.reinsurerRequestId },
    });

    return await confirmOnChain(requested, treaty, deps, actor);
  } catch (err) {
    const failureReason = err instanceof Error ? err.message : String(err);
    const failed = await prisma.capitalDrawdown.update({
      where: { id: drawdown.id },
      data: { status: "FAILED", failureReason },
    });

    await recordAudit(prisma, {
      action: "CAPITAL_REQUEST_FAILED",
      actor,
      treatyId: treaty.id,
      drawdownId: drawdown.id,
      detail: { failureReason },
    });

    return failed;
  }
}

async function confirmOnChain(
  drawdown: CapitalDrawdown,
  treaty: Treaty,
  deps: DrawdownOrchestratorDeps,
  actor: string,
): Promise<CapitalDrawdown> {
  const { prisma, onChainClient } = deps;

  try {
    const confirmation = await onChainClient.confirmDrawdown({
      poolId: treaty.poolId,
      drawdownId: drawdown.id,
      amount: drawdown.amountRequested,
    });

    const confirmed = await prisma.capitalDrawdown.update({
      where: { id: drawdown.id },
      data: {
        status: "CONFIRMED",
        onChainTxHash: confirmation.txHash,
        onChainConfirmedAt: confirmation.confirmedAt,
      },
    });

    await recordAudit(prisma, {
      action: "DRAWDOWN_CONFIRMED",
      actor,
      treatyId: treaty.id,
      drawdownId: drawdown.id,
      detail: { onChainTxHash: confirmation.txHash },
    });

    return confirmed;
  } catch (err) {
    const failureReason = err instanceof Error ? err.message : String(err);
    const failed = await prisma.capitalDrawdown.update({
      where: { id: drawdown.id },
      data: { status: "FAILED", failureReason },
    });

    await recordAudit(prisma, {
      action: "DRAWDOWN_CONFIRMATION_FAILED",
      actor,
      treatyId: treaty.id,
      drawdownId: drawdown.id,
      detail: { failureReason },
    });

    return failed;
  }
}
