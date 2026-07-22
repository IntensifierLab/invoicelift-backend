import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  createTreaty,
  getTreaty,
  listTreaties,
  updateTreaty,
} from "../../src/services/treatyService.js";
import { resetDb } from "../dbHelpers.js";

const prisma = new PrismaClient();

describe("treatyService", () => {
  beforeEach(async () => {
    await resetDb(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("creates a treaty and records a TREATY_CREATED audit entry", async () => {
    const treaty = await createTreaty(
      prisma,
      {
        poolId: "pool-a",
        reinsurerName: "Re A",
        facilityLimit: 100_000,
        triggerThreshold: 0.8,
        costBps: 200,
      },
      "test:actor",
    );

    expect(treaty.poolId).toBe("pool-a");
    expect(treaty.status).toBe("ACTIVE");

    const entries = await prisma.facilityAuditEntry.findMany({
      where: { treatyId: treaty.id },
    });
    expect(entries).toHaveLength(1);
    expect(entries[0].action).toBe("TREATY_CREATED");
  });

  it("updates a treaty and records a TREATY_UPDATED audit entry", async () => {
    const treaty = await createTreaty(
      prisma,
      {
        poolId: "pool-a",
        reinsurerName: "Re A",
        facilityLimit: 100_000,
        triggerThreshold: 0.8,
        costBps: 200,
      },
      "test:actor",
    );

    const updated = await updateTreaty(
      prisma,
      treaty.id,
      { triggerThreshold: 0.85 },
      "test:actor",
    );
    expect(updated.triggerThreshold).toBe(0.85);

    const entries = await prisma.facilityAuditEntry.findMany({
      where: { treatyId: treaty.id, action: "TREATY_UPDATED" },
    });
    expect(entries).toHaveLength(1);
  });

  it("round-trips getTreaty/listTreaties", async () => {
    await createTreaty(
      prisma,
      {
        poolId: "pool-a",
        reinsurerName: "Re A",
        facilityLimit: 1,
        triggerThreshold: 0.5,
        costBps: 1,
      },
      "test:actor",
    );

    const list = await listTreaties(prisma);
    expect(list).toHaveLength(1);

    const fetched = await getTreaty(prisma, list[0].id);
    expect(fetched?.id).toBe(list[0].id);
  });
});
