import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  generateRegulatoryExport,
  verifyRegulatoryExportSignature,
} from "../../src/lib/regulatoryExport.js";
import { resetDb } from "../dbHelpers.js";

const prisma = new PrismaClient();

describe("regulatoryExport", () => {
  beforeEach(async () => {
    await resetDb(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const period = { periodStart: new Date("2026-01-01"), periodEnd: new Date("2026-01-31") };

  it("generates a JSON export with a verifiable signature", async () => {
    const record = await generateRegulatoryExport(prisma, {
      reportType: "POOL_UTILISATION",
      format: "JSON",
      ...period,
    });
    expect(record.format).toBe("JSON");
    expect(() => JSON.parse(record.content)).not.toThrow();
    expect(verifyRegulatoryExportSignature(record)).toBe(true);
  });

  it("generates a CSV export", async () => {
    await prisma.pool.create({ data: { poolId: "pool-csv", totalCapital: 100, utilisedCapital: 40 } });
    const record = await generateRegulatoryExport(prisma, {
      reportType: "POOL_UTILISATION",
      format: "CSV",
      ...period,
    });
    expect(record.content).toContain("poolId");
    expect(record.content).toContain("pool-csv");
    expect(verifyRegulatoryExportSignature(record)).toBe(true);
  });

  it("generates a valid PDF export", async () => {
    const record = await generateRegulatoryExport(prisma, {
      reportType: "DEFAULT_RATE",
      format: "PDF",
      ...period,
    });
    const pdfBytes = Buffer.from(record.content, "base64");
    expect(pdfBytes.subarray(0, 5).toString()).toBe("%PDF-");
    expect(verifyRegulatoryExportSignature(record)).toBe(true);
  });

  it("detects a tampered export", async () => {
    const record = await generateRegulatoryExport(prisma, {
      reportType: "INVOICE_VOLUME",
      format: "JSON",
      ...period,
    });
    const tampered = { ...record, content: record.content + "tampered" };
    expect(verifyRegulatoryExportSignature(tampered)).toBe(false);
  });

  it("computes pool utilisation percentage correctly", async () => {
    await prisma.pool.create({ data: { poolId: "p1", totalCapital: 1000, utilisedCapital: 250 } });
    const record = await generateRegulatoryExport(prisma, {
      reportType: "POOL_UTILISATION",
      format: "JSON",
      ...period,
    });
    const rows = JSON.parse(record.content);
    expect(rows[0].utilisationPct).toBeCloseTo(0.25);
  });
});
