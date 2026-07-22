import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { evaluateAndDraw } from "../../src/services/drawdownOrchestrator.js";
import { StubOnChainClient } from "../../src/lib/onChainClient.js";
import { StubReinsurerClient } from "../../src/lib/reinsurerClient.js";
import type { PoolStateProvider } from "../../src/lib/poolStateProvider.js";
import { resetDb } from "../dbHelpers.js";

const prisma = new PrismaClient();

function fakePoolStateProvider(utilisationRatio: number): PoolStateProvider {
  return {
    async getPoolState(poolId: string) {
      return {
        poolId,
        totalCapital: 1000,
        utilisedCapital: Math.round(1000 * utilisationRatio),
        utilisationRatio,
      };
    },
  };
}

describe("drawdownOrchestrator.evaluateAndDraw", () => {
  beforeEach(async () => {
    await resetDb(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("returns null and creates no drawdown when utilisation is below the trigger threshold", async () => {
    const treaty = await prisma.treaty.create({
      data: {
        poolId: "pool-a",
        reinsurerName: "Re A",
        facilityLimit: 1000,
        triggerThreshold: 0.9,
        costBps: 100,
      },
    });

    const result = await evaluateAndDraw(
      treaty,
      {
        prisma,
        poolStateProvider: fakePoolStateProvider(0.5),
        reinsurerClient: new StubReinsurerClient(),
        onChainClient: new StubOnChainClient(),
      },
      "test:actor",
    );

    expect(result).toBeNull();
    const drawdowns = await prisma.capitalDrawdown.findMany({ where: { treatyId: treaty.id } });
    expect(drawdowns).toHaveLength(0);
  });

  it("drives a full PENDING -> REQUESTED -> CONFIRMED progression on breach, with matching audit entries", async () => {
    const treaty = await prisma.treaty.create({
      data: {
        poolId: "pool-a",
        reinsurerName: "Re A",
        facilityLimit: 1000,
        triggerThreshold: 0.9,
        costBps: 100,
      },
    });

    const result = await evaluateAndDraw(
      treaty,
      {
        prisma,
        poolStateProvider: fakePoolStateProvider(0.95),
        reinsurerClient: new StubReinsurerClient(),
        onChainClient: new StubOnChainClient(),
      },
      "test:actor",
    );

    expect(result).not.toBeNull();
    expect(result?.status).toBe("CONFIRMED");
    expect(result?.onChainTxHash).toMatch(/^stub_/);
    expect(result?.reinsurerRequestId).toMatch(/^stub_/);

    const actions = (
      await prisma.facilityAuditEntry.findMany({
        where: { treatyId: treaty.id },
        orderBy: { createdAt: "asc" },
      })
    ).map((e) => e.action);

    expect(actions).toEqual([
      "MONITOR_CHECK_RUN",
      "THRESHOLD_BREACH_DETECTED",
      "CAPITAL_REQUESTED",
      "DRAWDOWN_CONFIRMED",
    ]);
  });

  it("marks the drawdown FAILED and audits CAPITAL_REQUEST_FAILED when the reinsurer call throws", async () => {
    const treaty = await prisma.treaty.create({
      data: {
        poolId: "pool-a",
        reinsurerName: "Re A",
        facilityLimit: 1000,
        triggerThreshold: 0.9,
        costBps: 100,
      },
    });

    const throwingReinsurer = {
      async requestCapital(): Promise<never> {
        throw new Error("reinsurer unavailable");
      },
    };

    const result = await evaluateAndDraw(
      treaty,
      {
        prisma,
        poolStateProvider: fakePoolStateProvider(0.95),
        reinsurerClient: throwingReinsurer,
        onChainClient: new StubOnChainClient(),
      },
      "test:actor",
    );

    expect(result?.status).toBe("FAILED");
    expect(result?.failureReason).toBe("reinsurer unavailable");

    const failedAudit = await prisma.facilityAuditEntry.findFirst({
      where: { treatyId: treaty.id, action: "CAPITAL_REQUEST_FAILED" },
    });
    expect(failedAudit).not.toBeNull();
  });

  it("bypasses the threshold check when force is true", async () => {
    const treaty = await prisma.treaty.create({
      data: {
        poolId: "pool-a",
        reinsurerName: "Re A",
        facilityLimit: 1000,
        triggerThreshold: 0.99,
        costBps: 100,
      },
    });

    const result = await evaluateAndDraw(
      treaty,
      {
        prisma,
        poolStateProvider: fakePoolStateProvider(0.1),
        reinsurerClient: new StubReinsurerClient(),
        onChainClient: new StubOnChainClient(),
      },
      "test:actor",
      { force: true },
    );

    expect(result?.status).toBe("CONFIRMED");
  });
});
