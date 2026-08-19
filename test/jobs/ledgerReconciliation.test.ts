import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { LedgerSnapshot, OnChainClient } from "../../src/lib/onChainClient.js";
import { runReconciliationTick } from "../../src/jobs/ledgerReconciliation.js";
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

describe("runReconciliationTick", () => {
  beforeEach(async () => {
    await resetDb(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("persists a healthy run when snapshots match", async () => {
    await runReconciliationTick(
      prisma,
      fakeOnChainClient({ invoiceCount: 0, poolTvl: 0, repaymentTotal: 0 }),
    );
    const runs = await prisma.reconciliationRun.findMany();
    expect(runs).toHaveLength(1);
    expect(runs[0].healthy).toBe(true);
  });

  it("persists an unhealthy run with discrepancies when snapshots diverge", async () => {
    await runReconciliationTick(
      prisma,
      fakeOnChainClient({ invoiceCount: 42, poolTvl: 0, repaymentTotal: 0 }),
    );
    const runs = await prisma.reconciliationRun.findMany();
    expect(runs).toHaveLength(1);
    expect(runs[0].healthy).toBe(false);
    expect(JSON.stringify(runs[0].discrepancies)).toContain("invoiceCount");
  });
});
