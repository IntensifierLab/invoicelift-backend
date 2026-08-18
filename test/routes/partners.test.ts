import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { facilityDeps } from "../../src/lib/facilityDeps.js";
import { buildServer } from "../../src/server.js";
import { resetDb } from "../dbHelpers.js";

describe("partner routes", () => {
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

  it("registers a partner and returns the raw API key once", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/partners",
      payload: { name: "Acme Corp", contactEmail: "ops@acme.example" },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.apiKey).toMatch(/^ilift_live_/);
    expect(body.partner).not.toHaveProperty("apiKeyHash");
    expect(body.partner.name).toBe("Acme Corp");
  });

  it("rejects registration with an invalid email", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/partners",
      payload: { name: "Acme Corp", contactEmail: "not-an-email" },
    });

    expect(res.statusCode).toBe(400);
  });

  it("rejects registration with a missing name", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/partners",
      payload: { contactEmail: "ops@acme.example" },
    });

    expect(res.statusCode).toBe(400);
  });

  it("revokes a registered partner", async () => {
    const register = await app.inject({
      method: "POST",
      url: "/api/v1/partners",
      payload: { name: "Acme Corp", contactEmail: "ops@acme.example" },
    });
    const partnerId = register.json().partner.id;

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/partners/${partnerId}/revoke`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().active).toBe(false);
  });

  it("returns 404 revoking an unknown partner", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/partners/does-not-exist/revoke",
    });

    expect(res.statusCode).toBe(404);
  });
});
