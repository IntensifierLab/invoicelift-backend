import { beforeEach, describe, expect, it } from "vitest";
import { facilityDeps } from "../../src/lib/facilityDeps.js";
import {
  UnknownBuyerError,
  checkSystemicAlerts,
  getBuyerExposure,
  getPoolCorrelationMatrix,
  simulateDefaultContagion,
} from "../../src/services/riskAnalyticsService.js";
import { resetDb } from "../dbHelpers.js";

const prisma = facilityDeps.prisma;
const BUYER_A = "GBUYERA00000000000000000000000000000000000000000000000000";
const BUYER_B = "GBUYERB00000000000000000000000000000000000000000000000000";
const SME = "GSME00000000000000000000000000000000000000000000000000000";

async function seedInvoice(opts: {
  reference: string;
  buyerAddress: string;
  poolId: string | null;
  amount: number;
  status?: "VERIFIED" | "PENDING_SME_SIGNATURE";
}) {
  return prisma.invoice.create({
    data: {
      reference: opts.reference,
      smeAddress: SME,
      buyerAddress: opts.buyerAddress,
      poolId: opts.poolId,
      amount: opts.amount,
      dueDate: new Date(),
      invoiceHash: `hash-${opts.reference}`,
      status: opts.status ?? "VERIFIED",
    },
  });
}

describe("riskAnalyticsService", () => {
  beforeEach(async () => {
    await resetDb(prisma);
  });

  it("computes buyer exposure across pools from VERIFIED invoices only", async () => {
    await seedInvoice({ reference: "INV-1", buyerAddress: BUYER_A, poolId: "pool-1", amount: 1000 });
    await seedInvoice({ reference: "INV-2", buyerAddress: BUYER_A, poolId: "pool-2", amount: 500 });
    await seedInvoice({
      reference: "INV-3",
      buyerAddress: BUYER_A,
      poolId: "pool-1",
      amount: 9999,
      status: "PENDING_SME_SIGNATURE",
    });

    const exposures = await getBuyerExposure(prisma);
    expect(exposures).toHaveLength(1);
    expect(exposures[0].buyerAddress).toBe(BUYER_A);
    expect(exposures[0].totalExposure).toBe(1500);
    expect(exposures[0].byPool).toEqual(
      expect.arrayContaining([
        { poolId: "pool-1", exposure: 1000 },
        { poolId: "pool-2", exposure: 500 },
      ]),
    );
  });

  it("computes a pool correlation matrix based on shared buyers", async () => {
    await seedInvoice({ reference: "INV-1", buyerAddress: BUYER_A, poolId: "pool-1", amount: 100 });
    await seedInvoice({ reference: "INV-2", buyerAddress: BUYER_A, poolId: "pool-2", amount: 100 });
    await seedInvoice({ reference: "INV-3", buyerAddress: BUYER_B, poolId: "pool-1", amount: 100 });

    const { poolIds, matrix } = await getPoolCorrelationMatrix(prisma);
    expect(poolIds).toEqual(["pool-1", "pool-2"]);
    // pool-1 has buyers {A, B}, pool-2 has buyers {A} -> intersection 1, union 2 -> 0.5
    expect(matrix[0][1]).toBeCloseTo(0.5);
    expect(matrix[1][0]).toBeCloseTo(0.5);
    expect(matrix[0][0]).toBe(1);
  });

  it("simulates default contagion for a buyer with direct and indirect pool impact", async () => {
    await prisma.pool.createMany({
      data: [
        { poolId: "pool-1", totalCapital: 10_000, utilisedCapital: 2_000 },
        { poolId: "pool-2", totalCapital: 5_000, utilisedCapital: 1_000 },
      ],
    });
    await seedInvoice({ reference: "INV-1", buyerAddress: BUYER_A, poolId: "pool-1", amount: 1_000 });
    await seedInvoice({ reference: "INV-2", buyerAddress: BUYER_B, poolId: "pool-2", amount: 200 });

    const result = await simulateDefaultContagion(prisma, BUYER_A);
    expect(result.totalExposure).toBe(1_000);
    expect(result.directImpact).toEqual([
      {
        poolId: "pool-1",
        exposure: 1_000,
        totalCapital: 10_000,
        utilisationBefore: 0.2,
        utilisationAfter: 0.1,
      },
    ]);
  });

  it("throws UnknownBuyerError for a buyer with no VERIFIED exposure", async () => {
    await expect(simulateDefaultContagion(prisma, "does-not-exist")).rejects.toBeInstanceOf(
      UnknownBuyerError,
    );
  });

  it("raises a POOL_UTILISATION alert above the configured threshold", async () => {
    await prisma.pool.create({
      data: { poolId: "hot-pool", totalCapital: 1_000, utilisedCapital: 900 },
    });

    const alerts = await checkSystemicAlerts(prisma);
    expect(alerts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "POOL_UTILISATION", poolId: "hot-pool" }),
      ]),
    );
  });

  it("raises a BUYER_CONCENTRATION alert when one buyer dominates system capital", async () => {
    await prisma.pool.create({ data: { poolId: "pool-1", totalCapital: 1_000, utilisedCapital: 0 } });
    await seedInvoice({ reference: "INV-1", buyerAddress: BUYER_A, poolId: "pool-1", amount: 900 });

    const alerts = await checkSystemicAlerts(prisma);
    expect(alerts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "BUYER_CONCENTRATION", buyerAddress: BUYER_A }),
      ]),
    );
  });
});
