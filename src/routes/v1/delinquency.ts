import type { FastifyPluginAsync } from "fastify";
import {
  initiateDelinquency,
  processDelinquencyWorkflow,
  resolveDelinquency,
  getDelinquencyRecord,
  listDelinquencyRecords,
  getAuditLog,
  getAuditLogForDelinquency,
  initiateDelinquencySchema,
  resolveDelinquencySchema,
} from "../../services/delinquency.js";

export const delinquencyRoutes: FastifyPluginAsync = async (app) => {
  /**
   * POST /delinquencies — Initiate a delinquency workflow for an overdue invoice
   */
  app.post("/delinquencies", async (request, reply) => {
    const parsed = initiateDelinquencySchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.status(400).send({
        error: "Validation failed",
        details: parsed.error.flatten().fieldErrors,
      });
    }

    const record = initiateDelinquency(parsed.data);

    return reply.status(201).send({
      id: record.id,
      invoiceId: record.invoiceId,
      poolId: record.poolId,
      buyerAddress: record.buyerAddress,
      originalAmount: record.originalAmount,
      status: record.status,
      overdueSince: record.overdueSince,
      events: record.events,
      createdAt: record.createdAt,
    });
  });

  /**
   * GET /delinquencies — List all delinquency records
   */
  app.get("/delinquencies", async (_request, reply) => {
    const records = listDelinquencyRecords();

    return reply.send({
      records: records.map((r) => ({
        id: r.id,
        invoiceId: r.invoiceId,
        poolId: r.poolId,
        status: r.status,
        originalAmount: r.originalAmount,
        overdueSince: r.overdueSince,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      })),
      total: records.length,
    });
  });

  /**
   * GET /delinquencies/:id — Get a specific delinquency record with full details
   */
  app.get<{ Params: { id: string } }>("/delinquencies/:id", async (request, reply) => {
    const { id } = request.params;
    const record = getDelinquencyRecord(id);

    if (!record) {
      return reply.status(404).send({ error: "Delinquency record not found" });
    }

    // Process through workflow to check for state transitions
    const processed = processDelinquencyWorkflow(record);

    return reply.send({
      id: processed.id,
      invoiceId: processed.invoiceId,
      poolId: processed.poolId,
      buyerAddress: processed.buyerAddress,
      originalAmount: processed.originalAmount,
      status: processed.status,
      overdueSince: processed.overdueSince,
      events: processed.events,
      restructuringProposal: processed.restructuringProposal,
      lossRecognisedAt: processed.lossRecognisedAt,
      defaultRecordedTxHash: processed.defaultRecordedTxHash,
      createdAt: processed.createdAt,
      updatedAt: processed.updatedAt,
    });
  });

  /**
   * POST /delinquencies/:id/process — Manually trigger workflow processing
   */
  app.post<{ Params: { id: string } }>(
    "/delinquencies/:id/process",
    async (request, reply) => {
      const { id } = request.params;
      const record = getDelinquencyRecord(id);

      if (!record) {
        return reply.status(404).send({ error: "Delinquency record not found" });
      }

      if (record.status === "resolved") {
        return reply.status(409).send({
          error: "Delinquency is already resolved",
        });
      }

      const processed = processDelinquencyWorkflow(record);

      return reply.send({
        id: processed.id,
        status: processed.status,
        events: processed.events,
        restructuringProposal: processed.restructuringProposal,
        lossRecognisedAt: processed.lossRecognisedAt,
        defaultRecordedTxHash: processed.defaultRecordedTxHash,
        updatedAt: processed.updatedAt,
      });
    },
  );

  /**
   * POST /delinquencies/:id/resolve — Mark a delinquency as resolved
   */
  app.post<{
    Params: { id: string };
    Body: { resolutionNotes?: string };
  }>("/delinquencies/:id/resolve", async (request, reply) => {
    const { id } = request.params;
    const record = getDelinquencyRecord(id);

    if (!record) {
      return reply.status(404).send({ error: "Delinquency record not found" });
    }

    if (record.status === "resolved") {
      return reply.status(409).send({
        error: "Delinquency is already resolved",
      });
    }

    const parsed = resolveDelinquencySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "Validation failed",
        details: parsed.error.flatten().fieldErrors,
      });
    }

    const resolved = resolveDelinquency(record);

    return reply.send({
      id: resolved.id,
      status: resolved.status,
      events: resolved.events,
      updatedAt: resolved.updatedAt,
    });
  });

  /**
   * GET /delinquencies/audit-log — Get full audit log
   */
  app.get("/delinquencies/audit-log", async (_request, reply) => {
    const entries = getAuditLog();
    return reply.send({ entries, total: entries.length });
  });

  /**
   * GET /delinquencies/:id/audit-log — Get audit log for a specific delinquency
   */
  app.get<{ Params: { id: string } }>(
    "/delinquencies/:id/audit-log",
    async (request, reply) => {
      const { id } = request.params;
      const record = getDelinquencyRecord(id);

      if (!record) {
        return reply.status(404).send({ error: "Delinquency record not found" });
      }

      const entries = getAuditLogForDelinquency(id);
      return reply.send({ entries, total: entries.length });
    },
  );
};
