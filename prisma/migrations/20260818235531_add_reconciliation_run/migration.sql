-- CreateTable
CREATE TABLE "ReconciliationRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "dbSnapshot" JSONB NOT NULL,
    "chainSnapshot" JSONB NOT NULL,
    "discrepancies" JSONB NOT NULL,
    "healthy" BOOLEAN NOT NULL,
    "ranAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "ReconciliationRun_healthy_idx" ON "ReconciliationRun"("healthy");

-- CreateIndex
CREATE INDEX "ReconciliationRun_ranAt_idx" ON "ReconciliationRun"("ranAt");
