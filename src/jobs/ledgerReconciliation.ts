import type { Prisma, PrismaClient } from "@prisma/client";
import type { OnChainClient } from "../lib/onChainClient.js";
import { runReconciliation } from "../lib/reconciliation.js";

/**
 * Runs one reconciliation tick, persists the result, and alerts (currently:
 * structured log — this scaffold has no paging/webhook integration yet, but
 * the persisted ReconciliationRun row is exactly what a future alert
 * consumer would poll or subscribe to) on any non-benign discrepancy.
 * Benign discrepancies are logged but don't alert — that's the "self-
 * healing" the issue asks for: nothing needs a human, the run record is
 * the audit trail that it happened and was within tolerance.
 */
export async function runReconciliationTick(
  prisma: PrismaClient,
  onChainClient: OnChainClient,
): Promise<void> {
  const result = await runReconciliation(prisma, onChainClient);

  await prisma.reconciliationRun.create({
    data: {
      dbSnapshot: result.dbSnapshot as unknown as Prisma.InputJsonValue,
      chainSnapshot: result.chainSnapshot as unknown as Prisma.InputJsonValue,
      discrepancies: result.discrepancies as unknown as Prisma.InputJsonValue,
      healthy: result.healthy,
    },
  });

  if (!result.healthy) {
    const alerting = result.discrepancies.filter((d) => !d.benign);
    // eslint-disable-next-line no-console -- structured alert; no paging/webhook integration exists yet.
    console.error("[ledger-reconciliation] non-benign discrepancy detected", alerting);
  }
}

export interface ReconciliationSchedulerHandle {
  stop(): void;
  triggerNow(): Promise<void>;
}

export function startLedgerReconciliationMonitor(
  prisma: PrismaClient,
  onChainClient: OnChainClient,
  intervalMinutes = 15,
): ReconciliationSchedulerHandle {
  const intervalMs = intervalMinutes * 60_000;
  let running = false;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runReconciliationTick(prisma, onChainClient);
    } finally {
      running = false;
    }
  };

  const handle = setInterval(() => {
    void tick();
  }, intervalMs);

  return {
    stop: () => clearInterval(handle),
    triggerNow: tick,
  };
}
