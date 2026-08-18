import { randomUUID } from "node:crypto";

/**
 * In-process async job queue. Not backed by Redis/BullMQ — this scaffold
 * has no message-broker dependency yet, and CI has no Redis service — but
 * the handler-registration shape (`register`/`enqueue`) mirrors BullMQ's
 * producer/worker split closely enough that swapping the internals for a
 * real BullMQ-backed queue later shouldn't require touching call sites.
 */

export type JobStatus = "pending" | "active" | "completed" | "failed" | "dead-letter";

export interface JobDefinition<T = unknown> {
  name: string;
  handler: (payload: T) => Promise<void>;
  /** Attempts before a job moves to the dead-letter queue. Default 3. */
  maxAttempts?: number;
  /** Per-attempt execution timeout in ms. Default 30s. */
  timeoutMs?: number;
  /** Base backoff in ms; doubles per retry (1st retry: backoffMs, 2nd: backoffMs*2, ...). Default 1s. */
  backoffMs?: number;
}

export interface JobRecord {
  id: string;
  name: string;
  payload: unknown;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  enqueuedAt: Date;
  updatedAt: Date;
  lastError?: string;
  nextAttemptAt?: Date;
}

export interface QueueStats {
  pending: number;
  active: number;
  completed: number;
  deadLetter: number;
  total: number;
}

class JobTimeoutError extends Error {
  constructor(ms: number) {
    super(`job timed out after ${ms}ms`);
    this.name = "JobTimeoutError";
  }
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new JobTimeoutError(ms)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

export class JobQueue {
  private readonly handlers = new Map<string, JobDefinition>();
  private readonly jobs = new Map<string, JobRecord>();
  private readonly pending: string[] = [];
  private readonly concurrency: number;
  private active = 0;
  private draining = false;
  private readonly retryTimers = new Set<ReturnType<typeof setTimeout>>();

  constructor(opts: { concurrency?: number } = {}) {
    this.concurrency = opts.concurrency ?? 2;
  }

  register<T>(definition: JobDefinition<T>): void {
    this.handlers.set(definition.name, definition as JobDefinition);
  }

  /** Throws if the queue is draining — callers should not enqueue new work during shutdown. */
  enqueue<T>(name: string, payload: T): string {
    if (this.draining) {
      throw new Error("job queue is draining; not accepting new jobs");
    }
    if (!this.handlers.has(name)) {
      throw new Error(`no handler registered for job "${name}"`);
    }
    const id = randomUUID();
    const def = this.handlers.get(name)!;
    const now = new Date();
    this.jobs.set(id, {
      id,
      name,
      payload,
      status: "pending",
      attempts: 0,
      maxAttempts: def.maxAttempts ?? 3,
      enqueuedAt: now,
      updatedAt: now,
    });
    this.pending.push(id);
    this.pump();
    return id;
  }

  private pump(): void {
    while (!this.draining && this.active < this.concurrency && this.pending.length > 0) {
      const id = this.pending.shift();
      if (!id) break;
      this.active++;
      void this.run(id).finally(() => {
        this.active--;
        this.pump();
      });
    }
  }

  private async run(id: string): Promise<void> {
    const job = this.jobs.get(id);
    if (!job) return;
    const def = this.handlers.get(job.name);
    if (!def) {
      job.status = "dead-letter";
      job.lastError = `no handler registered for job "${job.name}"`;
      job.updatedAt = new Date();
      return;
    }

    job.status = "active";
    job.attempts += 1;
    job.updatedAt = new Date();

    try {
      await withTimeout(def.handler(job.payload), def.timeoutMs ?? 30_000);
      job.status = "completed";
      job.updatedAt = new Date();
    } catch (err) {
      job.lastError = err instanceof Error ? err.message : String(err);
      job.updatedAt = new Date();

      if (job.attempts >= job.maxAttempts) {
        job.status = "dead-letter";
        return;
      }

      job.status = "pending";
      const backoffMs = (def.backoffMs ?? 1000) * 2 ** (job.attempts - 1);
      job.nextAttemptAt = new Date(Date.now() + backoffMs);

      const timer = setTimeout(() => {
        this.retryTimers.delete(timer);
        if (this.draining) return;
        this.pending.push(id);
        this.pump();
      }, backoffMs);
      this.retryTimers.add(timer);
    }
  }

  get(id: string): JobRecord | undefined {
    return this.jobs.get(id);
  }

  list(status?: JobStatus): JobRecord[] {
    const all = [...this.jobs.values()];
    return status ? all.filter((j) => j.status === status) : all;
  }

  deadLetter(): JobRecord[] {
    return this.list("dead-letter");
  }

  /** Re-enqueues a dead-letter job with a fresh attempt budget. Returns false if the job isn't dead-lettered. */
  retry(id: string): boolean {
    const job = this.jobs.get(id);
    if (!job || job.status !== "dead-letter") return false;
    job.status = "pending";
    job.attempts = 0;
    job.lastError = undefined;
    job.updatedAt = new Date();
    this.pending.push(id);
    this.pump();
    return true;
  }

  stats(): QueueStats {
    const jobs = [...this.jobs.values()];
    return {
      pending: jobs.filter((j) => j.status === "pending").length,
      active: jobs.filter((j) => j.status === "active").length,
      completed: jobs.filter((j) => j.status === "completed").length,
      deadLetter: jobs.filter((j) => j.status === "dead-letter").length,
      total: jobs.length,
    };
  }

  /**
   * Stops accepting new jobs and pending retries, and waits for in-flight
   * jobs to finish (up to `timeoutMs`). Already-scheduled retry timers are
   * cancelled rather than left to fire after shutdown.
   */
  async drain(timeoutMs = 30_000): Promise<void> {
    this.draining = true;
    for (const timer of this.retryTimers) clearTimeout(timer);
    this.retryTimers.clear();

    const start = Date.now();
    while (this.active > 0 && Date.now() - start < timeoutMs) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
}
