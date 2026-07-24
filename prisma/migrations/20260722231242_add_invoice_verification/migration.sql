-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reference" TEXT NOT NULL,
    "smeAddress" TEXT NOT NULL,
    "buyerAddress" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "dueDate" DATETIME NOT NULL,
    "invoiceHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING_SME_SIGNATURE',
    "smeSignature" TEXT,
    "smeSignedAt" DATETIME,
    "buyerSignature" TEXT,
    "buyerSignedAt" DATETIME,
    "verificationDeadline" DATETIME,
    "rejectionReason" TEXT,
    "verifiedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "InvoiceAuditEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "action" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "detail" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InvoiceAuditEntry_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_reference_key" ON "Invoice"("reference");

-- CreateIndex
CREATE INDEX "Invoice_status_idx" ON "Invoice"("status");

-- CreateIndex
CREATE INDEX "Invoice_verificationDeadline_idx" ON "Invoice"("verificationDeadline");

-- CreateIndex
CREATE INDEX "InvoiceAuditEntry_invoiceId_idx" ON "InvoiceAuditEntry"("invoiceId");
