import type { FastifyInstance } from "fastify";

const DEFAULT_DRAIN_TIMEOUT_MS = 30_000;
const DEFAULT_SIGNALS: NodeJS.Signals[] = ["SIGTERM", "SIGINT"];

export interface GracefulShutdownOptions {
  /** Max time to wait for in-flight requests to drain before forcing exit. */
  drainTimeoutMs?: number;
  signals?: NodeJS.Signals[];
  /** Injectable for tests; defaults to `process.exit`. */
  exit?: (code: number) => void;
}

/**
 * Registers SIGTERM/SIGINT handlers that drain in-flight requests before
 * shutting down. `app.close()` stops the HTTP server from accepting new
 * connections immediately (Node's `http.Server.close()` semantics) while
 * letting requests already in flight finish, then runs Fastify's `onClose`
 * hooks (job timers, Prisma disconnect — see server.ts). If draining takes
 * longer than `drainTimeoutMs`, the process is force-exited with a non-zero
 * code instead of hanging forever.
 */
export function registerGracefulShutdown(
  app: FastifyInstance,
  options: GracefulShutdownOptions = {},
): void {
  const drainTimeoutMs = options.drainTimeoutMs ?? DEFAULT_DRAIN_TIMEOUT_MS;
  const signals = options.signals ?? DEFAULT_SIGNALS;
  const exit = options.exit ?? ((code: number) => process.exit(code));

  let shuttingDown = false;

  const shutdown = (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;

    app.log.info(`Received ${signal}, draining in-flight requests (max ${drainTimeoutMs}ms)`);

    const forceExitTimer = setTimeout(() => {
      app.log.error(`Graceful shutdown exceeded ${drainTimeoutMs}ms, forcing exit`);
      exit(1);
    }, drainTimeoutMs);
    forceExitTimer.unref();

    app
      .close()
      .then(() => {
        clearTimeout(forceExitTimer);
        app.log.info("Graceful shutdown complete");
        exit(0);
      })
      .catch((err: unknown) => {
        clearTimeout(forceExitTimer);
        app.log.error(err, "Error while draining connections during shutdown");
        exit(1);
      });
  };

  for (const signal of signals) {
    process.on(signal, () => shutdown(signal));
  }
}
