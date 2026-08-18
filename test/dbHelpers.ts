import type { PrismaClient } from "@prisma/client";

export async function resetDb(prisma: PrismaClient): Promise<void> {
  await prisma.accountingConnection.deleteMany();
  await prisma.invoiceAuditEntry.deleteMany();
  await prisma.invoice.deleteMany();
  await prisma.facilityAuditEntry.deleteMany();
  await prisma.capitalDrawdown.deleteMany();
  await prisma.treaty.deleteMany();
  await prisma.pool.deleteMany();
  await prisma.emailLog.deleteMany();
  await prisma.notificationPreference.deleteMany();
  await prisma.kycCredential.deleteMany();
  await prisma.partner.deleteMany();
  await prisma.privilegedAuditEntry.deleteMany();
}
