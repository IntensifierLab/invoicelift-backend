import type { FastifyInstance } from "fastify";
import { Keypair } from "@stellar/stellar-sdk";
import { jwtVerify } from "jose";
import { afterAll, beforeAll, afterEach, describe, expect, it, vi } from "vitest";
import { config } from "../../src/config/env.js";
import { buildServer } from "../../src/server.js";

describe("auth routes", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildServer();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await app.close();
  });

  async function getChallenge() {
    const response = await app.inject({ method: "GET", url: "/api/v1/auth/challenge" });
    return { response, challenge: response.json() as { nonce: string; expiresAt: string } };
  }

  it("returns a nonce that expires in five minutes", async () => {
    const now = new Date("2026-07-24T12:00:00.000Z");
    vi.spyOn(Date, "now").mockReturnValue(now.getTime());

    const { response, challenge } = await getChallenge();

    expect(response.statusCode).toBe(200);
    expect(challenge.nonce).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(challenge.expiresAt).toBe("2026-07-24T12:05:00.000Z");
  });

  it("verifies a Stellar signature and returns the wallet identity in a JWT", async () => {
    const wallet = Keypair.random();
    const { challenge } = await getChallenge();
    const signature = wallet.sign(Buffer.from(challenge.nonce, "utf8")).toString("base64");

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/verify",
      payload: { nonce: challenge.nonce, walletAddress: wallet.publicKey(), signature },
    });

    expect(response.statusCode).toBe(200);
    const { payload } = await jwtVerify(
      response.json().token,
      new TextEncoder().encode(config.jwtSecret),
    );
    expect(payload.walletAddress).toBe(wallet.publicKey());
    expect(payload.role).toBe("user");
  });

  it("rejects reuse of a verified nonce", async () => {
    const wallet = Keypair.random();
    const { challenge } = await getChallenge();
    const payload = {
      nonce: challenge.nonce,
      walletAddress: wallet.publicKey(),
      signature: wallet.sign(Buffer.from(challenge.nonce, "utf8")).toString("base64"),
    };

    expect(
      (await app.inject({ method: "POST", url: "/api/v1/auth/verify", payload })).statusCode,
    ).toBe(200);
    expect(
      (await app.inject({ method: "POST", url: "/api/v1/auth/verify", payload })).statusCode,
    ).toBe(401);
  });

  it("rejects an expired nonce", async () => {
    const now = Date.now();
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(now);
    const wallet = Keypair.random();
    const { challenge } = await getChallenge();
    nowSpy.mockReturnValue(now + 5 * 60 * 1000);

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/verify",
      payload: {
        nonce: challenge.nonce,
        walletAddress: wallet.publicKey(),
        signature: wallet.sign(Buffer.from(challenge.nonce, "utf8")).toString("base64"),
      },
    });

    expect(response.statusCode).toBe(401);
  });

  it("consumes a nonce when the signature is invalid", async () => {
    const wallet = Keypair.random();
    const { challenge } = await getChallenge();
    const validSignature = wallet.sign(Buffer.from(challenge.nonce, "utf8")).toString("base64");

    const invalidResponse = await app.inject({
      method: "POST",
      url: "/api/v1/auth/verify",
      payload: {
        nonce: challenge.nonce,
        walletAddress: wallet.publicKey(),
        signature: Keypair.random()
          .sign(Buffer.from(challenge.nonce, "utf8"))
          .toString("base64"),
      },
    });
    const retryResponse = await app.inject({
      method: "POST",
      url: "/api/v1/auth/verify",
      payload: { nonce: challenge.nonce, walletAddress: wallet.publicKey(), signature: validSignature },
    });

    expect(invalidResponse.statusCode).toBe(401);
    expect(retryResponse.statusCode).toBe(401);
  });

  it("rejects a malformed Stellar public key", async () => {
    const { challenge } = await getChallenge();
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/verify",
      payload: { nonce: challenge.nonce, walletAddress: "not-a-wallet", signature: "invalid" },
    });

    expect(response.statusCode).toBe(401);
  });

  it("consumes a nonce when the verification payload is malformed", async () => {
    const wallet = Keypair.random();
    const { challenge } = await getChallenge();
    const signature = wallet.sign(Buffer.from(challenge.nonce, "utf8")).toString("base64");

    const malformedResponse = await app.inject({
      method: "POST",
      url: "/api/v1/auth/verify",
      payload: { nonce: challenge.nonce },
    });
    const retryResponse = await app.inject({
      method: "POST",
      url: "/api/v1/auth/verify",
      payload: { nonce: challenge.nonce, walletAddress: wallet.publicKey(), signature },
    });

    expect(malformedResponse.statusCode).toBe(400);
    expect(retryResponse.statusCode).toBe(401);
  });
});
