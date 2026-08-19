import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { runMonthlyRegulatoryExportTick } from "../../src/jobs/regulatoryExportScheduler.js";
import { resetDb } from "../dbHelpers.js";

const prisma = new PrismaClient();

describe("runMonthlyRegulatoryExportTick", () => {
  beforeEach(async () => {
    await resetDb(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("generates all four report types for the previous month", async () => {
    await runMonthlyRegulatoryExportTick(prisma);
    const records = await prisma.regulatoryExportRecord.findMany();
    const types = new Set(records.map((r) => r.reportType));
    expect(types).toEqual(
      new Set(["INVOICE_VOLUME", "DEFAULT_RATE", "POOL_UTILISATION", "WATERFALL_DISTRIBUTION"]),
    );
    expect(records.every((r) => r.format === "JSON")).toBe(true);
  });
});
