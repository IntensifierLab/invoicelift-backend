import type { FastifyPluginAsync } from "fastify";

export interface HealthRoutesOptions {
  checkCriticalDependency?: () => Promise<void>;
  now?: () => number;
  startedAt?: number;
  version?: string;
}

const PROCESS_STARTED_AT = Date.now();
const DEFAULT_VERSION = process.env.npm_package_version ?? "0.1.0";

export const healthRoutes: FastifyPluginAsync<HealthRoutesOptions> = async (app, options) => {
  const startedAt = options.startedAt ?? PROCESS_STARTED_AT;
  const now = options.now ?? Date.now;
  const version = options.version ?? DEFAULT_VERSION;
  const checkCriticalDependency = options.checkCriticalDependency ?? (async () => {});

  app.get("/health", async (_request, reply) => {
    const uptime = Math.max(0, Math.floor((now() - startedAt) / 1000));

    try {
      await checkCriticalDependency();
      return { status: "ok", version, uptime };
    } catch {
      return reply.code(503).send({
        status: "unavailable",
        version,
        uptime,
        error: "critical dependency unavailable",
      });
    }
  });
};