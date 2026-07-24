-- CreateTable
CREATE TABLE "KycCredential" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "subjectDid" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "issuerDid" TEXT NOT NULL,
    "credentialId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'VERIFIED',
    "issuedAt" DATETIME NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "verifiedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "credentialHash" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "KycCredential_credentialId_key" ON "KycCredential"("credentialId");

-- CreateIndex
CREATE INDEX "KycCredential_subjectDid_idx" ON "KycCredential"("subjectDid");
