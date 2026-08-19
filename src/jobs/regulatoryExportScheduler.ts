import type { PrismaClient } from "@prisma/client";
import { generateRegulatoryExport } from "../lib/regulatoryExport.js";

const REPORT_TYPES = [
  "INVOICE_VOLUME",
  "DEFAULT_RATE",
  "POOL_UTILISATION",
  "WATERFALL_DISTRIBUTION",
] as const;

/** Generates all four report types (as JSON) for the previous calendar month. */
export async function runMonthlyRegulatoryExportTick(prisma: PrismaClient): Promise<void> {
  const now = new Date();
  const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0, 23, 59, 59, 999));

  for (const reportType of REPORT_TYPES) {
    await generateRegulatoryExport(prisma, {
      reportType,
      format: "JSON",
      periodStart,
      periodEnd,
    });
  }
}

export interface RegulatoryExportSchedulerHandle {
  stop(): void;
  triggerNow(): Promise<void>;
}

/**
 * Polls once a day and generates the previous month's reports on the 1st.
 * A day-granularity poll (rather than computing the exact next-month
 * boundary and setting a single timeout) keeps this consistent with the
 * existing monitor jobs' simple setInterval pattern, and tolerates the
 * process being restarted without missing the monthly run by more than a day.
 */
export function startRegulatoryExportScheduler(prisma: PrismaClient): RegulatoryExportSchedulerHandle {
  const oneDayMs = 24 * 60 * 60 * 1000;
  let running = false;
  let lastRunMonthKey = "";

  const tick = async () => {
    if (running) return;
    const now = new Date();
    if (now.getUTCDate() !== 1) return;
    const monthKey = `${now.getUTCFullYear()}-${now.getUTCMonth()}`;
    if (monthKey === lastRunMonthKey) return;

    running = true;
    try {
      await runMonthlyRegulatoryExportTick(prisma);
      lastRunMonthKey = monthKey;
    } finally {
      running = false;
    }
  };

  const handle = setInterval(() => {
    void tick();
  }, oneDayMs);

  return {
    stop: () => clearInterval(handle),
    triggerNow: () => runMonthlyRegulatoryExportTick(prisma),
  };
}
