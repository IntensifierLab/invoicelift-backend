-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN "acknowledgedAt" DATETIME;
ALTER TABLE "Invoice" ADD COLUMN "acknowledgementNote" TEXT;
