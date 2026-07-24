import { beforeEach, describe, expect, it } from "vitest";
import { facilityDeps } from "../../src/lib/facilityDeps.js";
import {
  GovernanceBoundsError,
  PoolNotFoundError,
  createPool,
  updatePool,
} from "../../src/services/poolService.js";
import { resetDb } from "../dbHelpers.js";

const prisma = facilityDeps.prisma;
const onChainClient = facilityDeps.onChainClient;
const ACTOR = "test:pool-admin";

describe("poolService", () => {
  beforeEach(async () => {
    await resetDb(prisma);
  });

  it("creates a pool on-chain and in the database, and logs an audit entry", async () => {
    const pool = await createPool(
      prisma,
      onChainClient,
      { poolId: "pool-1", totalCapital: 10_000 },
      ACTOR,
    );

    expect(pool.poolId).toBe("pool-1");
    expect(pool.totalCapital).toBe(10_000);
    expect(pool.utilisedCapital).toBe(0);

    const entries = await prisma.facilityAuditEntry.findMany({ where: { poolId: "pool-1" } });
    expect(entries).toHaveLength(1);
    expect(entries[0].action).toBe("POOL_CREATED");
    expect((entries[0].detail as Record<string, unknown>).onChainTxHash).toBeTruthy();
  });

  it("rejects pool creation outside governance bounds", async () => {
    await expect(
      createPool(prisma, onChainClient, { poolId: "too-big", totalCapital: 999_999_999 }, ACTOR),
    ).rejects.toBeInstanceOf(GovernanceBoundsError);
  });

  it("rejects pool creation where utilisedCapital exceeds totalCapital", async () => {
    await expect(
      createPool(
        prisma,
        onChainClient,
        { poolId: "over-utilised", totalCapital: 100, utilisedCapital: 200 },
        ACTOR,
      ),
    ).rejects.toBeInstanceOf(GovernanceBoundsError);
  });

  it("updates pool parameters and logs an audit entry", async () => {
    await createPool(prisma, onChainClient, { poolId: "pool-2", totalCapital: 1_000 }, ACTOR);

    const updated = await updatePool(prisma, "pool-2", { totalCapital: 2_000 }, ACTOR);
    expect(updated.totalCapital).toBe(2_000);

    const entries = await prisma.facilityAuditEntry.findMany({
      where: { poolId: "pool-2", action: "POOL_UPDATED" },
    });
    expect(entries).toHaveLength(1);
  });

  it("throws PoolNotFoundError when updating an unknown pool", async () => {
    await expect(updatePool(prisma, "does-not-exist", { totalCapital: 1 }, ACTOR)).rejects.toBeInstanceOf(
      PoolNotFoundError,
    );
  });

  it("rejects an update that pushes utilisedCapital above the new totalCapital", async () => {
    await createPool(
      prisma,
      onChainClient,
      { poolId: "pool-3", totalCapital: 1_000, utilisedCapital: 900 },
      ACTOR,
    );

    await expect(updatePool(prisma, "pool-3", { totalCapital: 500 }, ACTOR)).rejects.toBeInstanceOf(
      GovernanceBoundsError,
    );
  });
});
