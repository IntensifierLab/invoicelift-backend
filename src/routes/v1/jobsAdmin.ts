import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { jobQueue } from "../../lib/jobs.js";
import type { JobStatus } from "../../lib/jobQueue.js";

const statusValues: [JobStatus, ...JobStatus[]] = [
  "pending",
  "active",
  "completed",
  "failed",
  "dead-letter",
];

const listQuerySchema = z.object({
  status: z.enum(statusValues).optional(),
});

/** Admin visibility into the async job queue: stats, per-status listing, dead-letter retry. */
export const jobsAdminRoutes: FastifyPluginAsync = async (app) => {
  app.get("/jobs/stats", async () => {
    return jobQueue.stats();
  });

  app.get("/jobs", async (req, reply) => {
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }
    return jobQueue.list(parsed.data.status);
  });

  app.get("/jobs/dead-letter", async () => {
    return jobQueue.deadLetter();
  });

  app.post("/jobs/:id/retry", async (req, reply) => {
    const { id } = req.params as { id: string };
    const retried = jobQueue.retry(id);
    if (!retried) {
      return reply.status(404).send({ error: "job not found or not in dead-letter status" });
    }
    return { retried: true, job: jobQueue.get(id) };
  });
};
