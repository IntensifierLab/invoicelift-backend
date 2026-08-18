import type { IncomingMessage } from "node:http";
import { describe, expect, it } from "vitest";
import { fastifyLoggerOptions, logger } from "../../src/lib/logger.js";

function fakeRequest(headers: Record<string, string | string[] | undefined>): IncomingMessage {
  return { headers } as unknown as IncomingMessage;
}

describe("logger", () => {
  it("exposes a level-configured pino instance for non-request-scoped logging", () => {
    expect(logger.level).toBeDefined();
    expect(typeof logger.info).toBe("function");
  });

  it("returns logger + genReqId as top-level Fastify constructor options", () => {
    const options = fastifyLoggerOptions();
    expect(options.logger).toEqual({ level: expect.any(String) });
    expect(typeof options.genReqId).toBe("function");
  });

  it("genReqId propagates an inbound x-request-id header as the correlation id", () => {
    const { genReqId } = fastifyLoggerOptions();
    const id = genReqId(fakeRequest({ "x-request-id": "req-abc-123" }));
    expect(id).toBe("req-abc-123");
  });

  it("genReqId falls back to x-correlation-id when x-request-id is absent", () => {
    const { genReqId } = fastifyLoggerOptions();
    const id = genReqId(fakeRequest({ "x-correlation-id": "corr-xyz" }));
    expect(id).toBe("corr-xyz");
  });

  it("genReqId mints a fresh UUID when no correlation header is present", () => {
    const { genReqId } = fastifyLoggerOptions();
    const id = genReqId(fakeRequest({}));
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });
});
