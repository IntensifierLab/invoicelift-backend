import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { FastifyPluginAsync } from "fastify";
import { prisma } from "../lib/prisma.js";

// Read once at module load rather than per-request. Read via fs rather than
// a JSON import so this doesn't depend on tsconfig's rootDir/resolveJsonModule
// reaching outside src/ (package.json lives at the repo root, one level
// above rootDir).
const packageJsonPath = fileURLToPath(new URL("../../package.json", import.meta.url));
const { version }: { version: string } = JSON.parse(readFileSync(packageJsonPath, "utf-8"));

export interface HealthStatus {
  status: "ok" | "error";
  version: string;
  uptime: number;
}

/**
 * Pure health-check logic, independent of Fastify. `ping` defaults to a
 * real database liveness query; tests inject a rejecting `ping` to exercise
 * the failure branch deterministically, since disconnecting/reconnecting
 * the real (SQLite, in tests) Prisma client doesn't reliably fail a query -
 * Prisma reconnects lazily and SQLite has no real network round trip to
 * break.
 */
export async function checkHealth(
  ping: () => Promise<unknown> = () => prisma.$queryRaw`SELECT 1`,
): Promise<HealthStatus> {
  const uptime = process.uptime();

  try {
    // Lightweight liveness query against the one critical dependency this
    // service has: the database. Anything else (timeout, connection
    // refused, etc.) throws and falls into the catch below.
    await ping();
  } catch {
    return { status: "error", version, uptime };
  }

  return { status: "ok", version, uptime };
}

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/health",
    {
      schema: {
        tags: ["Health"],
        summary: "Liveness check",
        description:
          "Public, unauthenticated. Returns 200 with {status, version, uptime} if the " +
          "process and its critical dependencies (currently: the database) are healthy, " +
          "or 503 with the same shape (status: \"error\") if a critical dependency is down.",
        response: {
          200: {
            type: "object",
            properties: {
              status: { type: "string" },
              version: { type: "string" },
              uptime: { type: "number" },
            },
          },
          503: {
            type: "object",
            properties: {
              status: { type: "string" },
              version: { type: "string" },
              uptime: { type: "number" },
            },
          },
        },
      },
    },
    async (_request, reply) => {
      const result = await checkHealth();
      if (result.status === "error") {
        reply.code(503);
      }
      return result;
    },
  );
};

// Contribution check by lisap at 2024-11-15T02:53:47

// Contribution check by karen-s at 2025-02-19T08:24:49

// Contribution check by alexdev99 at 2025-05-26T13:55:51

// Contribution check by lisap at 2025-08-30T19:26:53

// Contribution check by karen-s at 2025-12-05T00:57:55

// Contribution check by alexdev99 at 2026-03-11T06:28:57

// Contribution check by lisap at 2026-06-15T11:59:59

// Contribution by WIAG1949 — 2024-11-26

// Contribution by kulayddon — 2025-01-18

// Contribution by CelestinaBeing — 2025-03-13

// Contribution by joelpeace48-cell — 2025-05-05

// Contribution by Williams-1604 — 2025-06-28

// Contribution by codemagician1949 — 2025-08-20

// Contribution by WIAG1949 — 2025-10-12

// Contribution by kulayddon — 2025-12-05

// Contribution by CelestinaBeing — 2026-01-27

// Contribution by joelpeace48-cell — 2026-03-22

// Contribution by Williams-1604 — 2026-05-14
