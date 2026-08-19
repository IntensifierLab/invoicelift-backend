import type { PrismaClient } from "@prisma/client";

export interface ReportPeriod {
  periodStart: Date;
  periodEnd: Date;
}

export interface InvoiceVolumeRow {
  currency: string;
  count: number;
  totalAmount: number;
}

export async function computeInvoiceVolume(
  prisma: PrismaClient,
  period: ReportPeriod,
): Promise<InvoiceVolumeRow[]> {
  const invoices = await prisma.invoice.findMany({
    where: { createdAt: { gte: period.periodStart, lte: period.periodEnd } },
    select: { currency: true, amount: true },
  });

  const byCurrency = new Map<string, InvoiceVolumeRow>();
  for (const inv of invoices) {
    const row = byCurrency.get(inv.currency) ?? { currency: inv.currency, count: 0, totalAmount: 0 };
    row.count += 1;
    row.totalAmount += inv.amount;
    byCurrency.set(inv.currency, row);
  }
  return [...byCurrency.values()];
}

export interface DefaultRateRow {
  totalDrawdowns: number;
  failedDrawdowns: number;
  defaultRate: number;
}

export async function computeDefaultRate(
  prisma: PrismaClient,
  period: ReportPeriod,
): Promise<DefaultRateRow> {
  const drawdowns = await prisma.capitalDrawdown.findMany({
    where: { requestedAt: { gte: period.periodStart, lte: period.periodEnd } },
    select: { status: true },
  });

  const totalDrawdowns = drawdowns.length;
  const failedDrawdowns = drawdowns.filter((d) => d.status === "FAILED").length;
  return {
    totalDrawdowns,
    failedDrawdowns,
    defaultRate: totalDrawdowns === 0 ? 0 : failedDrawdowns / totalDrawdowns,
  };
}

export interface PoolUtilisationRow {
  poolId: string;
  totalCapital: number;
  utilisedCapital: number;
  utilisationPct: number;
}

export async function computePoolUtilisation(prisma: PrismaClient): Promise<PoolUtilisationRow[]> {
  const pools = await prisma.pool.findMany();
  return pools.map((p) => ({
    poolId: p.poolId,
    totalCapital: p.totalCapital,
    utilisedCapital: p.utilisedCapital,
    utilisationPct: p.totalCapital === 0 ? 0 : p.utilisedCapital / p.totalCapital,
  }));
}

export interface WaterfallRow {
  poolId: string;
  treatyId: string;
  reinsurerName: string;
  confirmedDrawdowns: number;
  cumulativeAllocated: number;
}

/**
 * Per-pool waterfall: for each pool, its treaties in the order they were
 * created (a proxy for facility seniority — this scaffold has no explicit
 * priority field), showing each treaty's confirmed-drawdown total and the
 * running cumulative allocation across the pool's treaties in that order.
 */
export async function computeWaterfallDistribution(
  prisma: PrismaClient,
  period: ReportPeriod,
): Promise<WaterfallRow[]> {
  const treaties = await prisma.treaty.findMany({
    orderBy: [{ poolId: "asc" }, { createdAt: "asc" }],
    include: {
      drawdowns: {
        where: {
          status: "CONFIRMED",
          onChainConfirmedAt: { gte: period.periodStart, lte: period.periodEnd },
        },
      },
    },
  });

  const rows: WaterfallRow[] = [];
  const cumulativeByPool = new Map<string, number>();
  for (const treaty of treaties) {
    const confirmedTotal = treaty.drawdowns.reduce((sum, d) => sum + d.amountRequested, 0);
    const running = (cumulativeByPool.get(treaty.poolId) ?? 0) + confirmedTotal;
    cumulativeByPool.set(treaty.poolId, running);
    rows.push({
      poolId: treaty.poolId,
      treatyId: treaty.id,
      reinsurerName: treaty.reinsurerName,
      confirmedDrawdowns: confirmedTotal,
      cumulativeAllocated: running,
    });
  }
  return rows;
}
