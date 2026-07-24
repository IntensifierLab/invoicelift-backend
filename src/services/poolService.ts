import type { Pool, PrismaClient } from "@prisma/client";
import { config } from "../config/env.js";
import { recordAudit } from "../lib/audit.js";
import type { OnChainClient } from "../lib/onChainClient.js";

export class GovernanceBoundsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GovernanceBoundsError";
  }
}

export class PoolNotFoundError extends Error {
  constructor(poolId: string) {
    super(`Pool "${poolId}" not found`);
    this.name = "PoolNotFoundError";
  }
}

function assertWithinGovernanceBounds(totalCapital: number, utilisedCapital: number): void {
  const { governanceMinPoolCapital: min, governanceMaxPoolCapital: max } = config;
  if (totalCapital < min || totalCapital > max) {
    throw new GovernanceBoundsError(
      `totalCapital ${totalCapital} is outside the governance-set bounds [${min}, ${max}]`,
    );
  }
  if (utilisedCapital > totalCapital) {
    throw new GovernanceBoundsError(
      `utilisedCapital ${utilisedCapital} cannot exceed totalCapital ${totalCapital}`,
    );
  }
  if (utilisedCapital < 0) {
    throw new GovernanceBoundsError("utilisedCapital cannot be negative");
  }
}

export interface CreatePoolInput {
  poolId: string;
  totalCapital: number;
  utilisedCapital?: number;
}

export async function createPool(
  prisma: PrismaClient,
  onChainClient: OnChainClient,
  input: CreatePoolInput,
  actor: string,
): Promise<Pool> {
  const utilisedCapital = input.utilisedCapital ?? 0;
  assertWithinGovernanceBounds(input.totalCapital, utilisedCapital);

  const onChainResult = await onChainClient.createPool({
    poolId: input.poolId,
    totalCapital: input.totalCapital,
  });

  const pool = await prisma.pool.create({
    data: {
      poolId: input.poolId,
      totalCapital: input.totalCapital,
      utilisedCapital,
    },
  });

  await recordAudit(prisma, {
    action: "POOL_CREATED",
    actor,
    poolId: pool.poolId,
    detail: {
      totalCapital: input.totalCapital,
      utilisedCapital,
      onChainTxHash: onChainResult.txHash,
    },
  });

  return pool;
}

export interface UpdatePoolInput {
  totalCapital?: number;
  utilisedCapital?: number;
}

export async function updatePool(
  prisma: PrismaClient,
  poolId: string,
  input: UpdatePoolInput,
  actor: string,
): Promise<Pool> {
  const existing = await prisma.pool.findUnique({ where: { poolId } });
  if (!existing) {
    throw new PoolNotFoundError(poolId);
  }

  const nextTotalCapital = input.totalCapital ?? existing.totalCapital;
  const nextUtilisedCapital = input.utilisedCapital ?? existing.utilisedCapital;
  assertWithinGovernanceBounds(nextTotalCapital, nextUtilisedCapital);

  const pool = await prisma.pool.update({
    where: { poolId },
    data: { totalCapital: nextTotalCapital, utilisedCapital: nextUtilisedCapital },
  });

  await recordAudit(prisma, {
    action: "POOL_UPDATED",
    actor,
    poolId: pool.poolId,
    detail: { ...input },
  });

  return pool;
}

export async function getPool(prisma: PrismaClient, poolId: string): Promise<Pool | null> {
  return prisma.pool.findUnique({ where: { poolId } });
}

export async function listPools(prisma: PrismaClient): Promise<Pool[]> {
  return prisma.pool.findMany();
}
