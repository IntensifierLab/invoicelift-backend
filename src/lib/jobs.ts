import { facilityDeps } from "./facilityDeps.js";
import { JobQueue } from "./jobQueue.js";
import { createMailTransport } from "./mailer.js";
import { sendNotification, type SendNotificationInput } from "../services/notificationService.js";

const mailer = createMailTransport();

/**
 * The shared job queue instance and its registered job types. `event-indexing`
 * and `fraud-scoring` are intentionally thin stub handlers — this issue is
 * about the queue infrastructure (retries, timeouts, dead-letter, admin
 * inspection, graceful drain), not about building an indexer or fraud model.
 * `email-notification` is wired to the real notification service so at
 * least one job type demonstrates the full path end to end.
 */
export const jobQueue = new JobQueue({ concurrency: 4 });

jobQueue.register<SendNotificationInput>({
  name: "email-notification",
  maxAttempts: 5,
  timeoutMs: 15_000,
  backoffMs: 2_000,
  handler: async (payload) => {
    await sendNotification(facilityDeps.prisma, mailer, payload);
  },
});

export interface EventIndexingPayload {
  contractId: string;
  ledgerSequence: number;
  eventType: string;
}

jobQueue.register<EventIndexingPayload>({
  name: "event-indexing",
  maxAttempts: 5,
  timeoutMs: 30_000,
  // Placeholder until a real on-chain event indexer exists — the queue
  // infrastructure (retries/timeout/DLQ) is what this issue is about.
  handler: async (payload) => {
    void payload;
  },
});

export interface FraudScoringPayload {
  invoiceId: string;
  amount: number;
  buyerAddress: string;
}

jobQueue.register<FraudScoringPayload>({
  name: "fraud-scoring",
  maxAttempts: 3,
  timeoutMs: 10_000,
  handler: async (payload) => {
    // Placeholder scoring heuristic pending a real fraud model.
    void payload;
  },
});

export interface RepaymentProcessingPayload {
  invoiceId: string;
  amount: number;
  txHash?: string;
}

jobQueue.register<RepaymentProcessingPayload>({
  name: "repayment-processing",
  maxAttempts: 5,
  timeoutMs: 20_000,
  backoffMs: 3_000,
  handler: async (payload) => {
    void payload;
  },
});
