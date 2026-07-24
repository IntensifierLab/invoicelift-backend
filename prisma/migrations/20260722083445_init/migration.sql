-- CreateTable
CREATE TABLE "Pool" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "poolId" TEXT NOT NULL,
    "totalCapital" INTEGER NOT NULL,
    "utilisedCapital" INTEGER NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Treaty" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "poolId" TEXT NOT NULL,
    "reinsurerName" TEXT NOT NULL,
    "facilityLimit" INTEGER NOT NULL,
    "triggerThreshold" REAL NOT NULL,
    "costBps" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "CapitalDrawdown" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "treatyId" TEXT NOT NULL,
    "amountRequested" INTEGER NOT NULL,
    "triggerReason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reinsurerRequestId" TEXT,
    "reinsurerResponse" JSONB,
    "onChainTxHash" TEXT,
    "onChainConfirmedAt" DATETIME,
    "failureReason" TEXT,
    "requestedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CapitalDrawdown_treatyId_fkey" FOREIGN KEY ("treatyId") REFERENCES "Treaty" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FacilityAuditEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "action" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "treatyId" TEXT,
    "drawdownId" TEXT,
    "detail" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FacilityAuditEntry_treatyId_fkey" FOREIGN KEY ("treatyId") REFERENCES "Treaty" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "FacilityAuditEntry_drawdownId_fkey" FOREIGN KEY ("drawdownId") REFERENCES "CapitalDrawdown" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Pool_poolId_key" ON "Pool"("poolId");

-- CreateIndex
CREATE INDEX "Treaty_poolId_idx" ON "Treaty"("poolId");

-- CreateIndex
CREATE INDEX "CapitalDrawdown_treatyId_idx" ON "CapitalDrawdown"("treatyId");

-- CreateIndex
CREATE INDEX "FacilityAuditEntry_treatyId_idx" ON "FacilityAuditEntry"("treatyId");

-- CreateIndex
CREATE INDEX "FacilityAuditEntry_drawdownId_idx" ON "FacilityAuditEntry"("drawdownId");
