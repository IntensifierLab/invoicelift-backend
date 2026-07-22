import type { AuditAction, Prisma, PrismaClient } from "@prisma/client";

export interface RecordAuditParams {
  action: AuditAction;
  actor: string;
  treatyId?: string;
  drawdownId?: string;
  detail: Record<string, unknown>;
}

export async function recordAudit(
  prisma: PrismaClient,
  params: RecordAuditParams,
): Promise<void> {
  await prisma.facilityAuditEntry.create({
    data: {
      action: params.action,
      actor: params.actor,
      treatyId: params.treatyId,
      drawdownId: params.drawdownId,
      detail: params.detail as Prisma.InputJsonValue,
    },
  });
}
