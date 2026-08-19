import { describe, expect, it, vi } from "vitest";
import { JobQueue } from "../../src/lib/jobQueue.js";

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

describe("JobQueue", () => {
  it("runs a registered job to completion", async () => {
    const queue = new JobQueue();
    const handler = vi.fn().mockResolvedValue(undefined);
    queue.register({ name: "test-job", handler });

    const id = queue.enqueue("test-job", { foo: "bar" });
    await waitFor(() => queue.get(id)?.status === "completed");

    expect(handler).toHaveBeenCalledWith({ foo: "bar" });
    expect(queue.stats().completed).toBe(1);
  });

  it("retries a failing job with backoff, then moves it to dead-letter after maxAttempts", async () => {
    const queue = new JobQueue();
    const handler = vi.fn().mockRejectedValue(new Error("boom"));
    queue.register({ name: "flaky", handler, maxAttempts: 2, backoffMs: 5 });

    const id = queue.enqueue("flaky", {});
    await waitFor(() => queue.get(id)?.status === "dead-letter");

    expect(handler).toHaveBeenCalledTimes(2);
    const job = queue.get(id)!;
    expect(job.status).toBe("dead-letter");
    expect(job.lastError).toBe("boom");
    expect(queue.deadLetter()).toHaveLength(1);
  });

  it("moves a job to dead-letter when it exceeds its timeout", async () => {
    const queue = new JobQueue();
    queue.register({
      name: "slow",
      timeoutMs: 20,
      maxAttempts: 1,
      handler: () => new Promise((resolve) => setTimeout(resolve, 500)),
    });

    const id = queue.enqueue("slow", {});
    await waitFor(() => queue.get(id)?.status === "dead-letter");

    expect(queue.get(id)?.lastError).toMatch(/timed out/);
  });

  it("allows retrying a dead-letter job with a fresh attempt budget", async () => {
    const queue = new JobQueue();
    let shouldFail = true;
    const handler = vi.fn().mockImplementation(async () => {
      if (shouldFail) throw new Error("first pass fails");
    });
    queue.register({ name: "retryable", handler, maxAttempts: 1, backoffMs: 5 });

    const id = queue.enqueue("retryable", {});
    await waitFor(() => queue.get(id)?.status === "dead-letter");

    shouldFail = false;
    const retried = queue.retry(id);
    expect(retried).toBe(true);

    await waitFor(() => queue.get(id)?.status === "completed");
    expect(queue.get(id)?.attempts).toBe(1);
  });

  it("rejects new work once draining, and drain() waits for in-flight jobs", async () => {
    const queue = new JobQueue({ concurrency: 1 });
    let released: () => void = () => {};
    const inFlight = new Promise<void>((resolve) => {
      released = resolve;
    });
    queue.register({
      name: "long-running",
      handler: () => inFlight,
    });

    queue.enqueue("long-running", {});
    await waitFor(() => queue.stats().active === 1);

    const drainPromise = queue.drain(1000);
    expect(() => queue.enqueue("long-running", {})).toThrow(/draining/);

    released();
    await drainPromise;
    expect(queue.stats().active).toBe(0);
  });

  it("throws when enqueueing an unregistered job name", () => {
    const queue = new JobQueue();
    expect(() => queue.enqueue("nonexistent", {})).toThrow(/no handler registered/);
  });
});
