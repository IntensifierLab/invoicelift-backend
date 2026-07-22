import { z } from "zod";

// --- Types ---

export type DelinquencyStatus =
  | "grace_period"
  | "restructuring_proposed"
  | "loss_recognised"
  | "resolved";

export interface DelinquencyRecord {
  id: string;
  invoiceId: string;
  poolId: string;
  buyerAddress: string;
  originalAmount: number;
  overdueSince: string;
  status: DelinquencyStatus;
  events: DelinquencyEvent[];
  restructuringProposal?: RestructuringProposal;
  lossRecognisedAt?: string;
  defaultRecordedTxHash?: string;
  createdAt: string;
  updatedAt: string;
}

export interface DelinquencyEvent {
  type:
    | "grace_period_started"
    | "notification_sent"
    | "restructuring_proposed"
    | "loss_recognised"
    | "default_recorded"
    | "reserve_fund_applied"
    | "resolved";
  timestamp: string;
  metadata?: Record<string, unknown>;
}

export interface RestructuringProposal {
  originalAmount: number;
  newAmount: number;
  extendedDays: number;
  newDueDate: string;
  terms: string;
  generatedAt: string;
}

export interface AuditLogEntry {
  id: string;
  delinquencyId: string;
  action: string;
  timestamp: string;
  details: Record<string, unknown>;
}

// --- In-memory stores (replace with DB in production) ---

const delinquencyRecords = new Map<string, DelinquencyRecord>();
const auditLog: AuditLogEntry[] = [];

// --- Helpers ---

function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function daysBetween(dateA: string, dateB: string): number {
  const a = new Date(dateA);
  const b = new Date(dateB);
  return Math.floor((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

function addDays(date: string, days: number): string {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

function emitEvent(
  record: DelinquencyRecord,
  type: DelinquencyEvent["type"],
  metadata?: Record<string, unknown>,
): void {
  record.events.push({
    type,
    timestamp: new Date().toISOString(),
    metadata,
  });
  record.updatedAt = new Date().toISOString();
}

function writeAuditLog(
  delinquencyId: string,
  action: string,
  details: Record<string, unknown>,
): void {
  auditLog.push({
    id: generateId("audit"),
    delinquencyId,
    action,
    timestamp: new Date().toISOString(),
    details,
  });
}

// --- Core workflow ---

export function initiateDelinquency(data: {
  invoiceId: string;
  poolId: string;
  buyerAddress: string;
  originalAmount: number;
  overdueSince: string;
}): DelinquencyRecord {
  const id = generateId("del");
  const now = new Date().toISOString();

  const record: DelinquencyRecord = {
    id,
    invoiceId: data.invoiceId,
    poolId: data.poolId,
    buyerAddress: data.buyerAddress,
    originalAmount: data.originalAmount,
    overdueSince: data.overdueSince,
    status: "grace_period",
    events: [],
    createdAt: now,
    updatedAt: now,
  };

  emitEvent(record, "grace_period_started", {
    overdueSince: data.overdueSince,
  });
  emitEvent(record, "notification_sent", {
    buyerAddress: data.buyerAddress,
  });

  writeAuditLog(id, "delinquency_initiated", {
    invoiceId: data.invoiceId,
    poolId: data.poolId,
    originalAmount: data.originalAmount,
  });

  delinquencyRecords.set(id, record);
  return record;
}

export function processDelinquencyWorkflow(
  record: DelinquencyRecord,
): DelinquencyRecord {
  const now = new Date().toISOString();
  const daysOverdue = daysBetween(record.overdueSince, now);

  // T+7 days: generate restructuring proposal
  if (daysOverdue >= 7 && record.status === "grace_period") {
    const proposal: RestructuringProposal = {
      originalAmount: record.originalAmount,
      newAmount: record.originalAmount,
      extendedDays: 30,
      newDueDate: addDays(record.overdueSince, 37),
      terms: "Extended payment terms with 0% penalty for restructuring compliance",
      generatedAt: now,
    };

    record.status = "restructuring_proposed";
    record.restructuringProposal = proposal;

    emitEvent(record, "restructuring_proposed", { proposal });
    writeAuditLog(record.id, "restructuring_proposed", { proposal });
  }

  // T+30 days: recognise loss and record default
  if (daysOverdue >= 30 && record.status === "restructuring_proposed") {
    record.status = "loss_recognised";
    record.lossRecognisedAt = now;

    emitEvent(record, "loss_recognised", {
      originalAmount: record.originalAmount,
    });

    // Simulate on-chain default recording
    const txHash = `soroban_default_${record.id}_${Date.now()}`;
    record.defaultRecordedTxHash = txHash;

    emitEvent(record, "default_recorded", { txHash });

    // Apply reserve fund
    emitEvent(record, "reserve_fund_applied", {
      poolId: record.poolId,
      amountCovered: record.originalAmount,
    });

    writeAuditLog(record.id, "loss_recognised", {
      txHash,
      amount: record.originalAmount,
    });
  }

  return record;
}

export function resolveDelinquency(
  record: DelinquencyRecord,
): DelinquencyRecord {
  record.status = "resolved";
  emitEvent(record, "resolved");
  writeAuditLog(record.id, "delinquency_resolved", {});
  return record;
}

// --- Accessors ---

export function getDelinquencyRecord(
  id: string,
): DelinquencyRecord | undefined {
  return delinquencyRecords.get(id);
}

export function listDelinquencyRecords(): DelinquencyRecord[] {
  return Array.from(delinquencyRecords.values());
}

export function getAuditLog(): AuditLogEntry[] {
  return [...auditLog];
}

export function getAuditLogForDelinquency(
  delinquencyId: string,
): AuditLogEntry[] {
  return auditLog.filter((entry) => entry.delinquencyId === delinquencyId);
}

// --- Zod schemas for validation ---

export const initiateDelinquencySchema = z.object({
  invoiceId: z.string().min(1),
  poolId: z.string().min(1),
  buyerAddress: z.string().min(1),
  originalAmount: z.number().positive(),
  overdueSince: z.string().datetime(),
});

export const resolveDelinquencySchema = z.object({
  resolutionNotes: z.string().optional(),
});

export type InitiateDelinquencyInput = z.infer<
  typeof initiateDelinquencySchema
>;
export type ResolveDelinquencyInput = z.infer<typeof resolveDelinquencySchema>;
