import type { PrismaClient } from "@prisma/client";

export class InvoiceNotFoundError extends Error {
  constructor(invoiceId: string) {
    super(`No invoice found with id "${invoiceId}"`);
    this.name = "InvoiceNotFoundError";
  }
}

export type FraudRiskLevel = "low" | "medium" | "high";

export interface FraudSignal {
  code: string;
  description: string;
  weight: number;
}

export interface FraudScoreResult {
  invoiceId: string;
  score: number;
  riskLevel: FraudRiskLevel;
  signals: FraudSignal[];
}

// Invoice financing normally runs net-30/60/90; a due date this close to
// creation is atypical and worth flagging rather than treating as routine.
const RUSH_DUE_DATE_DAYS = 3;
const RUSH_DUE_DATE_WEIGHT = 20;

// Fabricated invoices skew toward round figures; a real one is rarely an
// exact multiple of a large denomination.
const ROUND_AMOUNT_THRESHOLD = 10_000;
const ROUND_AMOUNT_WEIGHT = 10;

// How far above an SME's own historical average an invoice has to be before
// it's flagged as an outlier, and how many prior invoices are required
// before "average" is meaningful enough to compare against.
const AMOUNT_OUTLIER_MULTIPLIER = 3;
const AMOUNT_OUTLIER_MIN_HISTORY = 3;
const AMOUNT_OUTLIER_WEIGHT = 25;

const NEW_COUNTERPARTY_WEIGHT = 15;

// Same SME->buyer pair invoicing repeatedly in a short window resembles
// invoice-splitting or a compromised account pushing volume through fast.
const VELOCITY_WINDOW_HOURS = 24;
const VELOCITY_MIN_COUNT = 3;
const VELOCITY_WEIGHT = 30;

const MEDIUM_RISK_THRESHOLD = 30;
const HIGH_RISK_THRESHOLD = 60;

function riskLevelForScore(score: number): FraudRiskLevel {
  if (score >= HIGH_RISK_THRESHOLD) return "high";
  if (score >= MEDIUM_RISK_THRESHOLD) return "medium";
  return "low";
}

/**
 * Heuristic fraud/risk score (0-100) for a single invoice, computed from
 * simple deterministic signals over the invoice itself and its SME's/buyer's
 * history — no ML model, no external data. Each signal is independently
 * explainable so a reviewer can see exactly why an invoice scored the way
 * it did, which matters more than raw accuracy for a human-in-the-loop
 * underwriting flow. Scores are informational only; nothing here blocks
 * invoice creation or financing.
 */
export async function computeFraudScore(
  prisma: PrismaClient,
  invoiceId: string,
): Promise<FraudScoreResult> {
  const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId } });
  if (!invoice) {
    throw new InvoiceNotFoundError(invoiceId);
  }

  const signals: FraudSignal[] = [];

  const daysToDue = (invoice.dueDate.getTime() - invoice.createdAt.getTime()) / 86_400_000;
  if (daysToDue < RUSH_DUE_DATE_DAYS) {
    signals.push({
      code: "RUSH_DUE_DATE",
      description: `Due ${daysToDue.toFixed(1)} day(s) after creation — unusually short for invoice financing`,
      weight: RUSH_DUE_DATE_WEIGHT,
    });
  }

  if (invoice.amount >= ROUND_AMOUNT_THRESHOLD && invoice.amount % ROUND_AMOUNT_THRESHOLD === 0) {
    signals.push({
      code: "ROUND_AMOUNT",
      description: `Amount ${invoice.amount} is an exact multiple of ${ROUND_AMOUNT_THRESHOLD}`,
      weight: ROUND_AMOUNT_WEIGHT,
    });
  }

  const priorForSme = await prisma.invoice.findMany({
    where: { smeAddress: invoice.smeAddress, id: { not: invoice.id } },
    select: { amount: true },
  });
  if (priorForSme.length >= AMOUNT_OUTLIER_MIN_HISTORY) {
    const avg = priorForSme.reduce((sum, i) => sum + i.amount, 0) / priorForSme.length;
    if (avg > 0 && invoice.amount >= avg * AMOUNT_OUTLIER_MULTIPLIER) {
      signals.push({
        code: "AMOUNT_OUTLIER",
        description: `Amount ${invoice.amount} is ${(invoice.amount / avg).toFixed(1)}x this SME's historical average (${avg.toFixed(0)})`,
        weight: AMOUNT_OUTLIER_WEIGHT,
      });
    }
  }

  const priorPairingCount = await prisma.invoice.count({
    where: {
      smeAddress: invoice.smeAddress,
      buyerAddress: invoice.buyerAddress,
      id: { not: invoice.id },
    },
  });
  if (priorPairingCount === 0 && invoice.amount >= ROUND_AMOUNT_THRESHOLD) {
    signals.push({
      code: "NEW_COUNTERPARTY_LARGE_AMOUNT",
      description: "First invoice between this SME and buyer, at a large amount",
      weight: NEW_COUNTERPARTY_WEIGHT,
    });
  }

  const velocityWindowStart = new Date(
    invoice.createdAt.getTime() - VELOCITY_WINDOW_HOURS * 3_600_000,
  );
  const recentPairCount = await prisma.invoice.count({
    where: {
      smeAddress: invoice.smeAddress,
      buyerAddress: invoice.buyerAddress,
      createdAt: { gte: velocityWindowStart, lte: invoice.createdAt },
    },
  });
  if (recentPairCount >= VELOCITY_MIN_COUNT) {
    signals.push({
      code: "HIGH_VELOCITY",
      description: `${recentPairCount} invoices between this SME and buyer within ${VELOCITY_WINDOW_HOURS}h`,
      weight: VELOCITY_WEIGHT,
    });
  }

  const score = Math.min(
    100,
    signals.reduce((sum, signal) => sum + signal.weight, 0),
  );

  return {
    invoiceId: invoice.id,
    score,
    riskLevel: riskLevelForScore(score),
    signals,
  };
}
