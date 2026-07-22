import type { PrismaClient, Treaty, TreatyStatus } from "@prisma/client";
import { recordAudit } from "../lib/audit.js";

export interface CreateTreatyInput {
  poolId: string;
  reinsurerName: string;
  facilityLimit: number;
  triggerThreshold: number;
  costBps: number;
  currency?: string;
}

export interface UpdateTreatyInput {
  reinsurerName?: string;
  facilityLimit?: number;
  triggerThreshold?: number;
  costBps?: number;
  currency?: string;
  status?: TreatyStatus;
}

export async function createTreaty(
  prisma: PrismaClient,
  input: CreateTreatyInput,
  actor: string,
): Promise<Treaty> {
  const treaty = await prisma.treaty.create({ data: input });

  await recordAudit(prisma, {
    action: "TREATY_CREATED",
    actor,
    treatyId: treaty.id,
    detail: { ...input },
  });

  return treaty;
}

export async function updateTreaty(
  prisma: PrismaClient,
  id: string,
  input: UpdateTreatyInput,
  actor: string,
): Promise<Treaty> {
  const treaty = await prisma.treaty.update({ where: { id }, data: input });

  await recordAudit(prisma, {
    action: "TREATY_UPDATED",
    actor,
    treatyId: treaty.id,
    detail: { ...input },
  });

  return treaty;
}

export async function getTreaty(prisma: PrismaClient, id: string): Promise<Treaty | null> {
  return prisma.treaty.findUnique({ where: { id } });
}

export async function listTreaties(
  prisma: PrismaClient,
  filter?: { status?: TreatyStatus },
): Promise<Treaty[]> {
  return prisma.treaty.findMany({ where: filter });
}
