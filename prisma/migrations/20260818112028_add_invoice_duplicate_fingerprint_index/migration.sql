-- CreateIndex
CREATE INDEX "Invoice_buyerAddress_amount_dueDate_idx" ON "Invoice"("buyerAddress", "amount", "dueDate");
