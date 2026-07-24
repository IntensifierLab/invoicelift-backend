import { randomBytes } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import { SignJWT } from "jose";
import { z } from "zod";
import { config } from "../../config/env.js";
import {
  isValidStellarAddress,
  verifyStellarSignature,
} from "../../lib/stellarSignature.js";

const NONCE_TTL_MS = 5 * 60 * 1000;
const JWT_TTL = "15m";
const USER_ROLE = "user";
const nonces = new Map<string, number>();

const verifySchema = z.object({
  nonce: z.string().min(1),
  walletAddress: z.string().min(1),
  signature: z.string().min(1),
});

export const authRoutes: FastifyPluginAsync = async (app) => {
  app.get("/auth/challenge", async () => {
    const now = Date.now();
    for (const [nonce, expiresAt] of nonces) {
      if (expiresAt <= now) nonces.delete(nonce);
    }

    const nonce = randomBytes(32).toString("base64url");
    const expiresAt = now + NONCE_TTL_MS;
    nonces.set(nonce, expiresAt);

    return { nonce, expiresAt: new Date(expiresAt).toISOString() };
  });

  app.post("/auth/verify", async (req, reply) => {
    const submittedNonce =
      typeof req.body === "object" &&
      req.body !== null &&
      "nonce" in req.body &&
      typeof req.body.nonce === "string"
        ? req.body.nonce
        : undefined;
    const expiresAt = submittedNonce ? nonces.get(submittedNonce) : undefined;
    if (submittedNonce) nonces.delete(submittedNonce);

    const parsed = verifySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    const { nonce, walletAddress, signature } = parsed.data;
    if (
      !expiresAt ||
      expiresAt <= Date.now() ||
      !isValidStellarAddress(walletAddress) ||
      !verifyStellarSignature(walletAddress, nonce, signature)
    ) {
      return reply.status(401).send({ error: "Invalid or expired authentication challenge" });
    }

    const token = await new SignJWT({ walletAddress, role: USER_ROLE })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(walletAddress)
      .setIssuedAt()
      .setExpirationTime(JWT_TTL)
      .sign(new TextEncoder().encode(config.jwtSecret));

    return { token };
  });
};
