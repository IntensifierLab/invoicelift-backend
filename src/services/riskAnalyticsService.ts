import type { PrismaClient } from "@prisma/client";
import { config } from "../config/env.js";

/**
 * Exposure is computed over VERIFIED invoices only — that is the point at
 * which a pool has actually funded the invoice and carries buyer credit
 * risk. Invoices without a poolId are counted in `totalExposure` but omitted
 * from `byPool` (there is no pool to attribute them to yet).
 */
export interface BuyerPoolExposure {
  poolId: string;
  exposure: number;
}

export interface BuyerExposure {
  buyerAddress: string;
  totalExposure: number;
  byPool: BuyerPoolExposure[];
}

export async function getBuyerExposure(prisma: PrismaClient): Promise<BuyerExposure[]> {
  const rows = await prisma.invoice.groupBy({
    by: ["buyerAddress", "poolId"],
    where: { status: "VERIFIED" },
    _sum: { amount: true },
  });

  const byBuyer = new Map<string, BuyerExposure>();
  for (const row of rows) {
    const amount = row._sum.amount ?? 0;
    let entry = byBuyer.get(row.buyerAddress);
    if (!entry) {
      entry = { buyerAddress: row.buyerAddress, totalExposure: 0, byPool: [] };
      byBuyer.set(row.buyerAddress, entry);
    }
    entry.totalExposure += amount;
    if (row.poolId) {
      entry.byPool.push({ poolId: row.poolId, exposure: amount });
    }
  }

  return [...byBuyer.values()].sort((a, b) => b.totalExposure - a.totalExposure);
}

/** poolId -> set of buyer addresses with VERIFIED exposure in that pool. */
async function getPoolBuyerSets(prisma: PrismaClient): Promise<Map<string, Set<string>>> {
  const rows = await prisma.invoice.findMany({
    where: { status: "VERIFIED", poolId: { not: null } },
    select: { poolId: true, buyerAddress: true },
  });

  const sets = new Map<string, Set<string>>();
  for (const row of rows) {
    const poolId = row.poolId as string;
    if (!sets.has(poolId)) sets.set(poolId, new Set());
    sets.get(poolId)!.add(row.buyerAddress);
  }
  return sets;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const item of a) {
    if (b.has(item)) intersection += 1;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export interface PoolCorrelationMatrix {
  poolIds: string[];
  /** matrix[i][j] = shared-buyer (Jaccard) correlation between poolIds[i] and poolIds[j], in [0, 1]. */
  matrix: number[][];
}

/**
 * Proxies pool-to-pool correlation via shared buyer counterparty exposure:
 * two pools that fund overlapping buyers carry correlated default risk, even
 * with no direct financial link between the pools themselves.
 */
export async function getPoolCorrelationMatrix(prisma: PrismaClient): Promise<PoolCorrelationMatrix> {
  const poolBuyerSets = await getPoolBuyerSets(prisma);
  const poolIds = [...poolBuyerSets.keys()].sort();

  const matrix = poolIds.map((rowId) =>
    poolIds.map((colId) => {
      if (rowId === colId) return 1;
      return jaccard(poolBuyerSets.get(rowId)!, poolBuyerSets.get(colId)!);
    }),
  );

  return { poolIds, matrix };
}

export interface ContagionPoolImpact {
  poolId: string;
  exposure: number;
  totalCapital: number;
  utilisationBefore: number;
  utilisationAfter: number;
}

export interface ContagionIndirectRisk {
  poolId: string;
  correlationScore: number;
}

export interface ContagionSimulationResult {
  buyerAddress: string;
  totalExposure: number;
  directImpact: ContagionPoolImpact[];
  indirectlyAtRisk: ContagionIndirectRisk[];
}

export class UnknownBuyerError extends Error {
  constructor(buyerAddress: string) {
    super(`No VERIFIED exposure found for buyer "${buyerAddress}"`);
    this.name = "UnknownBuyerError";
  }
}

/**
 * Simulates the buyer at `buyerAddress` defaulting on all VERIFIED invoices:
 * directly-exposed pools lose that exposure from utilised capital (a proxy
 * for a written-off drawdown), and pools that did not fund this buyer but
 * are highly correlated (shared-buyer Jaccard above the configured
 * threshold) with a directly-hit pool are surfaced as indirectly at risk.
 */
export async function simulateDefaultContagion(
  prisma: PrismaClient,
  buyerAddress: string,
): Promise<ContagionSimulationResult> {
  const exposures = await getBuyerExposure(prisma);
  const buyer = exposures.find((e) => e.buyerAddress === buyerAddress);
  if (!buyer || buyer.byPool.length === 0) {
    throw new UnknownBuyerError(buyerAddress);
  }

  const pools = await prisma.pool.findMany({
    where: { poolId: { in: buyer.byPool.map((p) => p.poolId) } },
  });
  const poolByPoolId = new Map(pools.map((p) => [p.poolId, p]));

  const directImpact: ContagionPoolImpact[] = buyer.byPool.map((exposure) => {
    const pool = poolByPoolId.get(exposure.poolId);
    const totalCapital = pool?.totalCapital ?? 0;
    const utilisedBefore = pool?.utilisedCapital ?? 0;
    const utilisedAfter = Math.max(0, utilisedBefore - exposure.exposure);
    return {
      poolId: exposure.poolId,
      exposure: exposure.exposure,
      totalCapital,
      utilisationBefore: totalCapital === 0 ? 0 : utilisedBefore / totalCapital,
      utilisationAfter: totalCapital === 0 ? 0 : utilisedAfter / totalCapital,
    };
  });

  const directPoolIds = new Set(directImpact.map((d) => d.poolId));
  const { poolIds, matrix } = await getPoolCorrelationMatrix(prisma);
  const threshold = config.systemicRiskCorrelationThreshold;

  const indirectlyAtRisk: ContagionIndirectRisk[] = [];
  for (const directPoolId of directPoolIds) {
    const rowIdx = poolIds.indexOf(directPoolId);
    if (rowIdx === -1) continue;
    poolIds.forEach((otherPoolId, colIdx) => {
      if (directPoolIds.has(otherPoolId)) return;
      const score = matrix[rowIdx][colIdx];
      if (score >= threshold && !indirectlyAtRisk.some((r) => r.poolId === otherPoolId)) {
        indirectlyAtRisk.push({ poolId: otherPoolId, correlationScore: score });
      }
    });
  }
  indirectlyAtRisk.sort((a, b) => b.correlationScore - a.correlationScore);

  return {
    buyerAddress,
    totalExposure: buyer.totalExposure,
    directImpact,
    indirectlyAtRisk,
  };
}

export type SystemicAlert =
  | { type: "POOL_UTILISATION"; poolId: string; utilisationRatio: number; threshold: number }
  | {
      type: "BUYER_CONCENTRATION";
      buyerAddress: string;
      exposure: number;
      shareOfSystemCapital: number;
      threshold: number;
    };

export async function checkSystemicAlerts(prisma: PrismaClient): Promise<SystemicAlert[]> {
  const alerts: SystemicAlert[] = [];

  const pools = await prisma.pool.findMany();
  const utilisationThreshold = config.systemicRiskUtilisationThreshold;
  for (const pool of pools) {
    if (pool.totalCapital === 0) continue;
    const ratio = pool.utilisedCapital / pool.totalCapital;
    if (ratio >= utilisationThreshold) {
      alerts.push({
        type: "POOL_UTILISATION",
        poolId: pool.poolId,
        utilisationRatio: ratio,
        threshold: utilisationThreshold,
      });
    }
  }

  const totalSystemCapital = pools.reduce((sum, p) => sum + p.totalCapital, 0);
  if (totalSystemCapital > 0) {
    const concentrationThreshold = config.systemicRiskBuyerConcentrationThreshold;
    const exposures = await getBuyerExposure(prisma);
    for (const buyer of exposures) {
      const share = buyer.totalExposure / totalSystemCapital;
      if (share >= concentrationThreshold) {
        alerts.push({
          type: "BUYER_CONCENTRATION",
          buyerAddress: buyer.buyerAddress,
          exposure: buyer.totalExposure,
          shareOfSystemCapital: share,
          threshold: concentrationThreshold,
        });
      }
    }
  }

  return alerts;
}
