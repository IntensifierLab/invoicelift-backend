import type { PrismaClient } from "@prisma/client";
import { config } from "../config/env.js";
import type { MailTransport } from "../lib/mailer.js";
import type { DrawdownOrchestratorDeps } from "../services/drawdownOrchestrator.js";
import { runInvoiceTimeoutTick } from "./invoiceVerificationTimeout.js";
import { runMonitorTick } from "./monitorFacilities.js";
import { runRepaymentReminderTick } from "./repaymentReminders.js";

export interface FacilityMonitorHandle {
  stop(): void;
  triggerNow(): Promise<void>;
}

export function startFacilityMonitor(deps: DrawdownOrchestratorDeps): FacilityMonitorHandle {
  const intervalMs = config.monitorIntervalMinutes * 60_000;
  let running = false;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runMonitorTick(deps);
    } finally {
      running = false;
    }
  };

  const handle = setInterval(() => {
    void tick();
  }, intervalMs);

  return {
    stop: () => clearInterval(handle),
    triggerNow: tick,
  };
}

export interface InvoiceTimeoutMonitorHandle {
  stop(): void;
  triggerNow(): Promise<void>;
}

export function startInvoiceTimeoutMonitor(prisma: PrismaClient): InvoiceTimeoutMonitorHandle {
  const intervalMs = config.invoiceTimeoutCheckIntervalMinutes * 60_000;
  let running = false;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runInvoiceTimeoutTick(prisma);
    } finally {
      running = false;
    }
  };

  const handle = setInterval(() => {
    void tick();
  }, intervalMs);

  return {
    stop: () => clearInterval(handle),
    triggerNow: tick,
  };
}

export interface RepaymentReminderMonitorHandle {
  stop(): void;
  triggerNow(): Promise<void>;
}

export function startRepaymentReminderMonitor(
  prisma: PrismaClient,
  mailer: MailTransport,
): RepaymentReminderMonitorHandle {
  const intervalMs = config.repaymentReminderCheckIntervalMinutes * 60_000;
  let running = false;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runRepaymentReminderTick(prisma, mailer, config.repaymentReminderDaysBefore);
    } finally {
      running = false;
    }
  };

  const handle = setInterval(() => {
    void tick();
  }, intervalMs);

  return {
    stop: () => clearInterval(handle),
    triggerNow: tick,
  };
}
