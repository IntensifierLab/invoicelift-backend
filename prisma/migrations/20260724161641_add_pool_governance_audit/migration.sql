-- AlterTable
ALTER TABLE "FacilityAuditEntry" ADD COLUMN "poolId" TEXT;

-- CreateIndex
CREATE INDEX "FacilityAuditEntry_poolId_idx" ON "FacilityAuditEntry"("poolId");
