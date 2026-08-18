import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";

/**
 * Standard envelope every error response is normalized into:
 * `{ error: { code, message, details? } }`.
 */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

/** Throw from route/service code to control the status + code of the standardized response. */
export class ApiError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

/**
 * Fastify itself, and plugins like @fastify/rate-limit, throw plain `Error`
 * objects decorated with a `statusCode` (and sometimes `code`) rather than a
 * dedicated error class — so `code` must be treated as optional here.
 */
function hasStatusCode(err: unknown): err is FastifyError {
  return typeof err === "object" && err !== null && "statusCode" in err;
}

/**
 * Global Fastify error handler: normalizes every unhandled error (thrown
 * ApiErrors, Zod validation errors, Fastify's own errors, and anything else)
 * into the `{error:{code,message,details}}` envelope, and strips stack
 * traces/internal messages outside development.
 */
export function standardErrorHandler(
  err: FastifyError | Error,
  req: FastifyRequest,
  reply: FastifyReply,
) {
  const isProd = process.env.NODE_ENV === "production";

  if (err instanceof ApiError) {
    const body: ApiErrorBody = { error: { code: err.code, message: err.message, details: err.details } };
    return reply.status(err.statusCode).send(body);
  }

  if (err instanceof ZodError) {
    const body: ApiErrorBody = {
      error: {
        code: "VALIDATION_ERROR",
        message: "Request validation failed",
        details: err.flatten(),
      },
    };
    return reply.status(400).send(body);
  }

  if (hasStatusCode(err) && typeof err.statusCode === "number" && err.statusCode < 500) {
    const body: ApiErrorBody = {
      error: {
        code: err.code ?? "BAD_REQUEST",
        message: err.message,
        details: (err as { validation?: unknown }).validation,
      },
    };
    return reply.status(err.statusCode).send(body);
  }

  req.log.error(err);
  const statusCode = (hasStatusCode(err) && err.statusCode) || 500;
  const body: ApiErrorBody = {
    error: {
      code: hasStatusCode(err) ? (err.code ?? "INTERNAL_ERROR") : "INTERNAL_ERROR",
      message: isProd ? "Internal server error" : err.message,
    },
  };
  return reply.status(statusCode).send(body);
}
