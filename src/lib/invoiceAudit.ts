import type { InvoiceAuditAction, Prisma, PrismaClient } from "@prisma/client";

export interface RecordInvoiceAuditParams {
  action: InvoiceAuditAction;
  actor: string;
  invoiceId: string;
  detail: Record<string, unknown>;
}

export async function recordInvoiceAudit(
  prisma: PrismaClient,
  params: RecordInvoiceAuditParams,
): Promise<void> {
  await prisma.invoiceAuditEntry.create({
    data: {
      action: params.action,
      actor: params.actor,
      invoiceId: params.invoiceId,
      detail: params.detail as Prisma.InputJsonValue,
    },
  });
}
