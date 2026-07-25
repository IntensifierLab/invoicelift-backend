import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";

describe("rate limiting", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildServer();
  });

  afterAll(async () => {
    await app.close();
  });

  it("returns 429 with Retry-After once the per-IP limit is exceeded", async () => {
    // Each test file's buildServer() call gets its own in-memory rate-limit
    // store, so exercising the real default (100 req/min) here doesn't
    // affect any other test file's requests.
    let lastStatus = 200;
    for (let i = 0; i < 101; i++) {
      const res = await app.inject({ method: "GET", url: "/health" });
      lastStatus = res.statusCode;
      if (lastStatus === 429) {
        expect(res.headers["retry-after"]).toBeDefined();
        return;
      }
    }

    expect.fail(`expected a 429 within 101 requests, last status was ${lastStatus}`);
  });
});
