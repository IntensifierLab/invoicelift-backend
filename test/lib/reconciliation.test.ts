import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { LedgerSnapshot, OnChainClient } from "../../src/lib/onChainClient.js";
import { computeDbSnapshot, diffSnapshots, runReconciliation } from "../../src/lib/reconciliation.js";
import { resetDb } from "../dbHelpers.js";

const prisma = new PrismaClient();

function fakeOnChainClient(snapshot: LedgerSnapshot): OnChainClient {
  return {
    getLedgerSnapshot: async () => snapshot,
    confirmDrawdown: async () => {
      throw new Error("not used in this test");
    },
    createPool: async () => {
      throw new Error("not used in this test");
    },
  };
}

describe("computeDbSnapshot", () => {
  beforeEach(async () => {
    await resetDb(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("aggregates invoice count, pool TVL, and confirmed drawdown totals", async () => {
    await prisma.pool.createMany({
      data: [
        { poolId: "p1", totalCapital: 1000, utilisedCapital: 0 },
        { poolId: "p2", totalCapital: 500, utilisedCapital: 0 },
      ],
    });
    await prisma.invoice.create({
      data: {
        reference: "inv-1",
        smeAddress: "SME",
        buyerAddress: "BUYER",
        amount: 100,
        dueDate: new Date(),
        invoiceHash: "hash",
      },
    });
    const treaty = await prisma.treaty.create({
      data: { poolId: "p1", reinsurerName: "Re", facilityLimit: 1000, triggerThreshold: 0.8, costBps: 100 },
    });
    await prisma.capitalDrawdown.create({
      data: { treatyId: treaty.id, amountRequested: 200, triggerReason: "test", status: "CONFIRMED" },
    });
    await prisma.capitalDrawdown.create({
      data: { treatyId: treaty.id, amountRequested: 999, triggerReason: "test", status: "PENDING" },
    });

    const snapshot = await computeDbSnapshot(prisma);
    expect(snapshot.invoiceCount).toBe(1);
    expect(snapshot.poolTvl).toBe(1500);
    expect(snapshot.repaymentTotal).toBe(200); // only the CONFIRMED drawdown counts
  });
});

describe("diffSnapshots", () => {
  it("returns no discrepancies for identical snapshots", () => {
    const snapshot = { invoiceCount: 5, poolTvl: 1000, repaymentTotal: 200 };
    expect(diffSnapshots(snapshot, snapshot)).toEqual([]);
  });

  it("flags a large discrepancy as non-benign", () => {
    const db = { invoiceCount: 10, poolTvl: 1000, repaymentTotal: 200 };
    const chain = { invoiceCount: 5, poolTvl: 1000, repaymentTotal: 200 };
    const discrepancies = diffSnapshots(db, chain);
    expect(discrepancies).toHaveLength(1);
    expect(discrepancies[0].metric).toBe("invoiceCount");
    expect(discrepancies[0].benign).toBe(false);
  });

  it("flags a tiny (rounding-scale) discrepancy as benign", () => {
    const db = { invoiceCount: 5, poolTvl: 1_000_000, repaymentTotal: 200 };
    const chain = { invoiceCount: 5, poolTvl: 1_000_000.5, repaymentTotal: 200 };
    const discrepancies = diffSnapshots(db, chain);
    expect(discrepancies).toHaveLength(1);
    expect(discrepancies[0].benign).toBe(true);
  });
});

describe("runReconciliation", () => {
  beforeEach(async () => {
    await resetDb(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("is healthy when the chain snapshot matches the DB exactly", async () => {
    const dbSnapshot = await computeDbSnapshot(prisma);
    const result = await runReconciliation(prisma, fakeOnChainClient(dbSnapshot));
    expect(result.healthy).toBe(true);
    expect(result.discrepancies).toEqual([]);
  });

  it("is unhealthy when the chain disagrees beyond tolerance", async () => {
    const result = await runReconciliation(
      prisma,
      fakeOnChainClient({ invoiceCount: 999, poolTvl: 0, repaymentTotal: 0 }),
    );
    expect(result.healthy).toBe(false);
    expect(result.discrepancies.some((d) => !d.benign)).toBe(true);
  });
});
