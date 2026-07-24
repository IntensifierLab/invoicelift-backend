-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN "poolId" TEXT;

-- CreateIndex
CREATE INDEX "Invoice_poolId_idx" ON "Invoice"("poolId");

-- CreateIndex
CREATE INDEX "Invoice_buyerAddress_idx" ON "Invoice"("buyerAddress");
