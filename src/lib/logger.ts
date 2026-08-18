import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import pino from "pino";
import { config } from "../config/env.js";

/**
 * Standalone structured JSON logger for code paths outside an HTTP request
 * (background jobs, mailer, startup) — same level config as the per-request
 * logger Fastify builds from `fastifyLoggerOptions()` below, so every log
 * line in the process (request-scoped or not) shares one JSON shape and one
 * LOG_LEVEL.
 */
export const logger = pino({ level: config.logLevel });

/**
 * Top-level Fastify constructor options controlling request logging —
 * spread into `Fastify({ ...fastifyLoggerOptions() })`. `genReqId` is a
 * Fastify-level option (not nested under `logger`); it propagates an
 * inbound `x-request-id`/`x-correlation-id` header when present (so a
 * correlation id can flow in from an upstream caller/gateway), otherwise
 * mints a fresh UUID — attached by Fastify to every log line for that
 * request as `reqId`.
 */
export function fastifyLoggerOptions() {
  return {
    logger: { level: config.logLevel },
    genReqId(req: IncomingMessage): string {
      const header = req.headers["x-request-id"] ?? req.headers["x-correlation-id"];
      const fromHeader = Array.isArray(header) ? header[0] : header;
      return fromHeader ?? randomUUID();
    },
  };
}
