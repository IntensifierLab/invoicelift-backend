import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { jobQueue } from "../../src/lib/jobs.js";
import { buildServer } from "../../src/server.js";

function waitFor(check: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (check()) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error("waitFor timed out"));
      setTimeout(tick, 10);
    };
    tick();
  });
}

describe("jobs admin routes", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildServer();
  });

  afterAll(async () => {
    await app.close();
  });

  it("reports queue stats via HTTP", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/jobs/stats" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty("pending");
    expect(body).toHaveProperty("active");
    expect(body).toHaveProperty("completed");
    expect(body).toHaveProperty("deadLetter");
  });

  it("lists dead-letter jobs and allows retrying one via HTTP", async () => {
    jobQueue.register<Record<string, never>>({
      name: "admin-test-flaky",
      maxAttempts: 1,
      backoffMs: 5,
      handler: async () => {
        throw new Error("intentional failure for test");
      },
    });
    const id = jobQueue.enqueue("admin-test-flaky", {});
    await waitFor(() => jobQueue.get(id)?.status === "dead-letter");

    const listRes = await app.inject({ method: "GET", url: "/api/v1/jobs/dead-letter" });
    expect(listRes.statusCode).toBe(200);
    expect(listRes.json().some((j: { id: string }) => j.id === id)).toBe(true);

    // Fresh handler so the retry actually succeeds this time.
    jobQueue.register<Record<string, never>>({
      name: "admin-test-flaky",
      handler: async () => undefined,
    });
    const retryRes = await app.inject({ method: "POST", url: `/api/v1/jobs/${id}/retry` });
    expect(retryRes.statusCode).toBe(200);
    expect(retryRes.json().retried).toBe(true);
  });

  it("returns 404 retrying a job that isn't in dead-letter status", async () => {
    const res = await app.inject({ method: "POST", url: "/api/v1/jobs/nonexistent-id/retry" });
    expect(res.statusCode).toBe(404);
  });

  it("rejects an unknown status filter with 400", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/jobs?status=bogus" });
    expect(res.statusCode).toBe(400);
  });
});
