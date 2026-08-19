import type { FastifyReply } from "fastify";
import type { z } from "zod";

export interface FieldError {
  path: string;
  message: string;
}

export type ValidationResult<T> =
  | { success: true; data: T }
  | { success: false; errors: FieldError[] };

/**
 * Wraps `schema.safeParse(input)`, mapping a failure into a flat array of
 * `{path, message}` pairs — one per offending field — instead of exposing
 * Zod's `ZodError` (or even its own `.flatten()`/`.format()` output) to the
 * caller. `path` joins nested keys with `.` (e.g. `"address.line1"`);
 * `message` is Zod's human-readable message for that field. Nothing about
 * the schema's internal shape/definition (types, regex patterns, refine
 * predicates) is ever included beyond that per-field message string.
 */
export function validateBody<T>(schema: z.ZodSchema<T>, input: unknown): ValidationResult<T> {
  const parsed = schema.safeParse(input);
  if (parsed.success) {
    return { success: true, data: parsed.data };
  }

  const errors: FieldError[] = parsed.error.issues.map((issue) => ({
    path: issue.path.join(".") || "(root)",
    message: issue.message,
  }));
  return { success: false, errors };
}

/**
 * Sends the standard 400 validation-failure response. Used together with
 * `validateBody`:
 *
 * ```ts
 * const parsed = validateBody(schema, req.body);
 * if (!parsed.success) return sendValidationError(reply, parsed.errors);
 * ```
 */
export function sendValidationError(reply: FastifyReply, errors: FieldError[]): FastifyReply {
  return reply.status(400).send({ error: "validation_failed", details: errors });
}
