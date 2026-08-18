import { createHash } from "node:crypto";
import type { PrismaClient, RegulatoryExportFormat, RegulatoryReportType } from "@prisma/client";
import { Keypair } from "@stellar/stellar-sdk";
import { config } from "../config/env.js";
import { generateTextPdf } from "./pdfGenerator.js";
import {
  computeDefaultRate,
  computeInvoiceVolume,
  computePoolUtilisation,
  computeWaterfallDistribution,
  type ReportPeriod,
} from "./regulatoryReport.js";

async function computeReportRows(
  prisma: PrismaClient,
  reportType: RegulatoryReportType,
  period: ReportPeriod,
): Promise<Record<string, unknown>[]> {
  switch (reportType) {
    case "INVOICE_VOLUME":
      return (await computeInvoiceVolume(prisma, period)) as unknown as Record<string, unknown>[];
    case "DEFAULT_RATE":
      return [(await computeDefaultRate(prisma, period)) as unknown as Record<string, unknown>];
    case "POOL_UTILISATION":
      return (await computePoolUtilisation(prisma)) as unknown as Record<string, unknown>[];
    case "WATERFALL_DISTRIBUTION":
      return (await computeWaterfallDistribution(prisma, period)) as unknown as Record<
        string,
        unknown
      >[];
  }
}

function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const escapeCell = (value: unknown) => {
    const s = String(value);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => escapeCell(row[h])).join(","));
  }
  return lines.join("\n");
}

function renderContent(
  format: RegulatoryExportFormat,
  reportType: RegulatoryReportType,
  rows: Record<string, unknown>[],
): string {
  switch (format) {
    case "JSON":
      return JSON.stringify(rows, null, 2);
    case "CSV":
      return toCsv(rows);
    case "PDF": {
      const lines =
        rows.length === 0
          ? ["(no rows for this period)"]
          : rows.map((row) => JSON.stringify(row));
      return generateTextPdf(`Regulatory Report: ${reportType}`, lines).toString("base64");
    }
  }
}

let cachedSigningKeypair: Keypair | undefined;

function getSigningKeypair(): Keypair {
  if (config.regulatoryExportSigningSecret) {
    return Keypair.fromSecret(config.regulatoryExportSigningSecret);
  }
  if (!cachedSigningKeypair) {
    cachedSigningKeypair = Keypair.random();
  }
  return cachedSigningKeypair;
}

export interface GenerateReportInput {
  reportType: RegulatoryReportType;
  format: RegulatoryExportFormat;
  periodStart: Date;
  periodEnd: Date;
}

export async function generateRegulatoryExport(prisma: PrismaClient, input: GenerateReportInput) {
  const rows = await computeReportRows(prisma, input.reportType, {
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
  });
  const content = renderContent(input.format, input.reportType, rows);
  const contentHash = createHash("sha256").update(content).digest("hex");

  const keypair = getSigningKeypair();
  const signature = keypair.signMessage(contentHash).toString("base64");

  return prisma.regulatoryExportRecord.create({
    data: {
      reportType: input.reportType,
      format: input.format,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      content,
      contentHash,
      signature,
      signerPublicKey: keypair.publicKey(),
    },
  });
}

export function verifyRegulatoryExportSignature(record: {
  content: string;
  contentHash: string;
  signature: string;
  signerPublicKey: string;
}): boolean {
  const recomputedHash = createHash("sha256").update(record.content).digest("hex");
  if (recomputedHash !== record.contentHash) return false;
  try {
    return Keypair.fromPublicKey(record.signerPublicKey).verifyMessage(
      record.contentHash,
      Buffer.from(record.signature, "base64"),
    );
  } catch {
    return false;
  }
}
