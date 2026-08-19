import type { PrismaClient } from "@prisma/client";
import type { LedgerSnapshot, OnChainClient } from "./onChainClient.js";

/**
 * A discrepancy is "benign" (self-healable — logged but not alerted) when
 * it's within this relative tolerance of the DB value. This scaffold's
 * StubOnChainClient always echoes the DB (zero drift), so in practice this
 * threshold only matters once a real chain reader can disagree with the DB
 * — e.g. floating-point/rounding differences from a differently-scaled
 * on-chain representation, not a real accounting break.
 */
const BENIGN_RELATIVE_TOLERANCE = 0.001; // 0.1%

export interface Discrepancy {
  metric: keyof LedgerSnapshot;
  dbValue: number;
  chainValue: number;
  delta: number;
  benign: boolean;
}

export interface ReconciliationResult {
  dbSnapshot: LedgerSnapshot;
  chainSnapshot: LedgerSnapshot;
  discrepancies: Discrepancy[];
  /** True if every discrepancy found (if any) was benign — nothing needs a human's attention. */
  healthy: boolean;
}

export async function computeDbSnapshot(prisma: PrismaClient): Promise<LedgerSnapshot> {
  const [invoiceCount, pools, confirmedDrawdowns] = await Promise.all([
    prisma.invoice.count(),
    prisma.pool.findMany({ select: { totalCapital: true } }),
    prisma.capitalDrawdown.findMany({
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

function isBenign(dbValue: number, chainValue: number): boolean {
  if (dbValue === chainValue) return true;
  const denominator = Math.max(Math.abs(dbValue), Math.abs(chainValue), 1);
  return Math.abs(dbValue - chainValue) / denominator <= BENIGN_RELATIVE_TOLERANCE;
}

export function diffSnapshots(db: LedgerSnapshot, chain: LedgerSnapshot): Discrepancy[] {
  const discrepancies: Discrepancy[] = [];
  const metrics: (keyof LedgerSnapshot)[] = ["invoiceCount", "poolTvl", "repaymentTotal"];

  for (const metric of metrics) {
    const dbValue = db[metric];
    const chainValue = chain[metric];
    if (dbValue === chainValue) continue;

    discrepancies.push({
      metric,
      dbValue,
      chainValue,
      delta: dbValue - chainValue,
      benign: isBenign(dbValue, chainValue),
    });
  }

  return discrepancies;
}

export async function runReconciliation(
  prisma: PrismaClient,
  onChainClient: OnChainClient,
): Promise<ReconciliationResult> {
  const [dbSnapshot, chainSnapshot] = await Promise.all([
    computeDbSnapshot(prisma),
    onChainClient.getLedgerSnapshot(),
  ]);

  const discrepancies = diffSnapshots(dbSnapshot, chainSnapshot);
  const healthy = discrepancies.every((d) => d.benign);

  return { dbSnapshot, chainSnapshot, discrepancies, healthy };
}
