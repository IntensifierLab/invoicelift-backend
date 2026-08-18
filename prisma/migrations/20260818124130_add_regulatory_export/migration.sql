-- CreateTable
CREATE TABLE "RegulatoryExportRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reportType" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "periodStart" DATETIME NOT NULL,
    "periodEnd" DATETIME NOT NULL,
    "content" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "signerPublicKey" TEXT NOT NULL,
    "generatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "RegulatoryExportRecord_reportType_periodStart_idx" ON "RegulatoryExportRecord"("reportType", "periodStart");
