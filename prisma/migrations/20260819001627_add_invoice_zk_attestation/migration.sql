-- CreateTable
CREATE TABLE "InvoiceZkAttestation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "invoiceId" TEXT NOT NULL,
    "commitment" TEXT NOT NULL,
    "nullifier" TEXT NOT NULL,
    "onChainTxHash" TEXT,
    "onChainConfirmedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InvoiceZkAttestation_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "InvoiceZkAttestation_nullifier_key" ON "InvoiceZkAttestation"("nullifier");

-- CreateIndex
CREATE INDEX "InvoiceZkAttestation_invoiceId_idx" ON "InvoiceZkAttestation"("invoiceId");
