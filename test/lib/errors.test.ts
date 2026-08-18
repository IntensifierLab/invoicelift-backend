import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { ZodError, z } from "zod";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, standardErrorHandler } from "../../src/lib/errors.js";

function fakeReply() {
  const reply = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) {
      reply.statusCode = code;
      return reply;
    },
    send(body: unknown) {
      reply.body = body;
      return reply;
    },
  };
  return reply as unknown as FastifyReply & { statusCode: number; body: unknown };
}

function fakeRequest() {
  return { log: { error: vi.fn() } } as unknown as FastifyRequest;
}

describe("standardErrorHandler", () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it("formats an ApiError with its own status/code/details", () => {
    const reply = fakeReply();
    const err = new ApiError(409, "DUPLICATE_INVOICE", "Invoice already exists", { field: "reference" });

    standardErrorHandler(err, fakeRequest(), reply);

    expect(reply.statusCode).toBe(409);
    expect(reply.body).toEqual({
      error: { code: "DUPLICATE_INVOICE", message: "Invoice already exists", details: { field: "reference" } },
    });
  });

  it("formats a ZodError as a 400 VALIDATION_ERROR with field details", () => {
    const reply = fakeReply();
    const schema = z.object({ amount: z.number() });
    const result = schema.safeParse({ amount: "not-a-number" });
    expect(result.success).toBe(false);
    const zodErr = (result as { error: ZodError }).error;

    standardErrorHandler(zodErr, fakeRequest(), reply);

    expect(reply.statusCode).toBe(400);
    const body = reply.body as { error: { code: string; details: unknown } };
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.details).toBeDefined();
  });

  it("hides the raw message and does not leak a stack trace for unexpected errors in production", () => {
    process.env.NODE_ENV = "production";
    const reply = fakeReply();
    const req = fakeRequest();

    standardErrorHandler(new Error("db connection string leaked here"), req, reply);

    expect(reply.statusCode).toBe(500);
    expect(reply.body).toEqual({ error: { code: "INTERNAL_ERROR", message: "Internal server error" } });
    expect(JSON.stringify(reply.body)).not.toContain("leaked");
    expect(req.log.error).toHaveBeenCalledOnce();
  });

  it("includes the real message for unexpected errors outside production", () => {
    process.env.NODE_ENV = "development";
    const reply = fakeReply();

    standardErrorHandler(new Error("boom"), fakeRequest(), reply);

    expect(reply.statusCode).toBe(500);
    expect(reply.body).toEqual({ error: { code: "INTERNAL_ERROR", message: "boom" } });
  });

  it("passes through a Fastify-native 4xx error with its own status/code", () => {
    const reply = fakeReply();
    const fastifyErr = Object.assign(new Error("Unsupported Media Type"), {
      code: "FST_ERR_CTP_INVALID_MEDIA_TYPE",
      statusCode: 415,
    }) as FastifyError;

    standardErrorHandler(fastifyErr, fakeRequest(), reply);

    expect(reply.statusCode).toBe(415);
    expect(reply.body).toEqual({
      error: { code: "FST_ERR_CTP_INVALID_MEDIA_TYPE", message: "Unsupported Media Type", details: undefined },
    });
  });
});
