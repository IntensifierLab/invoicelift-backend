import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { sendValidationError, validateBody } from "../../src/lib/validation.js";

describe("validateBody", () => {
  const schema = z.object({
    amount: z.number().int().positive(),
    address: z.object({ line1: z.string().min(1) }),
  });

  it("returns success with the parsed data when the body is valid", () => {
    const result = validateBody(schema, { amount: 5, address: { line1: "1 Main St" } });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ amount: 5, address: { line1: "1 Main St" } });
    }
  });

  it("returns field-level errors with dotted paths for nested fields", () => {
    const result = validateBody(schema, { amount: -1, address: { line1: "" } });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.errors.map((e) => e.path).sort();
      expect(paths).toEqual(["address.line1", "amount"]);
      for (const err of result.errors) {
        expect(typeof err.message).toBe("string");
        expect(err.message.length).toBeGreaterThan(0);
      }
    }
  });

  it("never includes Zod-internal keys in the response shape", () => {
    const result = validateBody(schema, { amount: "not a number" });
    expect(result.success).toBe(false);
    if (!result.success) {
      const serialized = JSON.stringify(result.errors);
      expect(serialized).not.toContain("_def");
      expect(serialized).not.toContain("_zod");
      // Only ever the two documented keys per entry.
      for (const err of result.errors) {
        expect(Object.keys(err).sort()).toEqual(["message", "path"]);
      }
    }
  });

  it("labels a top-level (non-field) issue with a root marker rather than an empty path", () => {
    const rootSchema = z.string().min(1);
    const result = validateBody(rootSchema, "");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors[0].path).toBe("(root)");
    }
  });
});

describe("sendValidationError", () => {
  it("sends a 400 with the standard {error, details} envelope", () => {
    const send = vi.fn();
    const status = vi.fn(() => ({ send }));
    const reply = { status } as unknown as import("fastify").FastifyReply;

    const errors = [{ path: "amount", message: "Required" }];
    sendValidationError(reply, errors);

    expect(status).toHaveBeenCalledWith(400);
    expect(send).toHaveBeenCalledWith({ error: "validation_failed", details: errors });
  });
});
