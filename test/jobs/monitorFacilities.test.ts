import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { runMonitorTick } from "../../src/jobs/monitorFacilities.js";
import { StubOnChainClient } from "../../src/lib/onChainClient.js";
import { StubReinsurerClient } from "../../src/lib/reinsurerClient.js";
import type { PoolStateProvider } from "../../src/lib/poolStateProvider.js";
import { resetDb } from "../dbHelpers.js";

const prisma = new PrismaClient();

describe("runMonitorTick", () => {
  beforeEach(async () => {
    await resetDb(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("only draws down the breaching treaty, leaving the non-breaching one alone", async () => {
    const breaching = await prisma.treaty.create({
      data: {
        poolId: "pool-breach",
        reinsurerName: "Re A",
        facilityLimit: 1000,
        triggerThreshold: 0.5,
        costBps: 100,
      },
    });
    const safe = await prisma.treaty.create({
      data: {
        poolId: "pool-safe",
        reinsurerName: "Re B",
        facilityLimit: 1000,
        triggerThreshold: 0.9,
        costBps: 100,
      },
    });

    const poolStateProvider: PoolStateProvider = {
      async getPoolState(poolId: string) {
        const ratio = poolId === "pool-breach" ? 0.9 : 0.1;
        return {
          poolId,
          totalCapital: 1000,
          utilisedCapital: Math.round(1000 * ratio),
          utilisationRatio: ratio,
        };
      },
    };

    await runMonitorTick({
      prisma,
      poolStateProvider,
      reinsurerClient: new StubReinsurerClient(),
      onChainClient: new StubOnChainClient(),
    });

    const breachingDrawdowns = await prisma.capitalDrawdown.findMany({
      where: { treatyId: breaching.id },
    });
    const safeDrawdowns = await prisma.capitalDrawdown.findMany({
      where: { treatyId: safe.id },
    });

    expect(breachingDrawdowns).toHaveLength(1);
    expect(breachingDrawdowns[0].status).toBe("CONFIRMED");
    expect(safeDrawdowns).toHaveLength(0);
  });

  it("does not let one treaty's pool-state lookup failure stop evaluation of the others", async () => {
    const broken = await prisma.treaty.create({
      data: {
        poolId: "pool-missing",
        reinsurerName: "Re A",
        facilityLimit: 1000,
        triggerThreshold: 0.5,
        costBps: 100,
      },
    });
    const ok = await prisma.treaty.create({
      data: {
        poolId: "pool-ok",
        reinsurerName: "Re B",
        facilityLimit: 1000,
        triggerThreshold: 0.5,
        costBps: 100,
      },
    });

    const poolStateProvider: PoolStateProvider = {
      async getPoolState(poolId: string) {
        if (poolId === "pool-missing") throw new Error("pool not found");
        return { poolId, totalCapital: 1000, utilisedCapital: 900, utilisationRatio: 0.9 };
      },
    };

    await runMonitorTick({
      prisma,
      poolStateProvider,
      reinsurerClient: new StubReinsurerClient(),
      onChainClient: new StubOnChainClient(),
    });

    const okDrawdowns = await prisma.capitalDrawdown.findMany({ where: { treatyId: ok.id } });
    expect(okDrawdowns).toHaveLength(1);
    expect(okDrawdowns[0].status).toBe("CONFIRMED");

    const brokenDrawdowns = await prisma.capitalDrawdown.findMany({
      where: { treatyId: broken.id },
    });
    expect(brokenDrawdowns).toHaveLength(0);
  });
});
