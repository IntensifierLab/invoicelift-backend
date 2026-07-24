-- CreateTable
CREATE TABLE "AccountingConnection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "smeAddress" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalTenantId" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "connectedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "AccountingConnection_provider_idx" ON "AccountingConnection"("provider");

-- CreateIndex
CREATE UNIQUE INDEX "AccountingConnection_smeAddress_provider_key" ON "AccountingConnection"("smeAddress", "provider");
