import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { facilityDeps } from "../../src/lib/facilityDeps.js";
import { buildServer } from "../../src/server.js";
import { resetDb } from "../dbHelpers.js";

describe("notification routes", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildServer();
  });

  beforeEach(async () => {
    await resetDb(facilityDeps.prisma);
  });

  afterAll(async () => {
    await app.close();
  });

  it("previews a template without sending or logging", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/notifications/preview",
      payload: { eventType: "DEFAULT_FLAGGED", data: { reference: "INV-9" } },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.subject).toContain("INV-9");

    const logs = await facilityDeps.prisma.emailLog.findMany();
    expect(logs).toHaveLength(0);
  });

  it("sends a notification and returns SENT", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/notifications/send",
      payload: { recipient: "buyer@example.com", eventType: "POOL_JOINED", data: { poolId: "p1" } },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("SENT");
  });

  it("gets and updates preferences via HTTP", async () => {
    const getRes = await app.inject({
      method: "GET",
      url: "/api/v1/notifications/preferences/lender@example.com",
    });
    expect(getRes.statusCode).toBe(200);
    expect(getRes.json().poolJoined).toBe(true);

    const patchRes = await app.inject({
      method: "PATCH",
      url: "/api/v1/notifications/preferences/lender@example.com",
      payload: { poolJoined: false },
    });
    expect(patchRes.statusCode).toBe(200);
    expect(patchRes.json().poolJoined).toBe(false);
  });

  it("returns 404 when recording a bounce for an unknown message id", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/notifications/bounce",
      payload: { providerMessageId: "unknown" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns 400 for an invalid preview payload", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/notifications/preview",
      payload: { eventType: "NOT_A_REAL_EVENT" },
    });
    expect(res.statusCode).toBe(400);
  });
});
