-- CreateTable
CREATE TABLE "SimulationRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "poolId" TEXT,
    "defaultRate" REAL NOT NULL,
    "correlation" REAL NOT NULL,
    "poolSize" INTEGER NOT NULL,
    "feePct" REAL NOT NULL,
    "lossGivenDefault" REAL NOT NULL,
    "trials" INTEGER NOT NULL,
    "confidenceLevel" REAL NOT NULL,
    "seed" INTEGER NOT NULL,
    "valueAtRisk" REAL NOT NULL,
    "conditionalValueAtRisk" REAL NOT NULL,
    "maxDrawdown" REAL NOT NULL,
    "lenderNetReturn" REAL NOT NULL,
    "lossDistribution" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "SimulationRun_poolId_idx" ON "SimulationRun"("poolId");
