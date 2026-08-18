-- CreateTable
CREATE TABLE "PrivilegedAuditEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "category" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "beforeState" JSONB,
    "afterState" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "PrivilegedAuditEntry_actor_idx" ON "PrivilegedAuditEntry"("actor");

-- CreateIndex
CREATE INDEX "PrivilegedAuditEntry_category_action_idx" ON "PrivilegedAuditEntry"("category", "action");

-- CreateIndex
CREATE INDEX "PrivilegedAuditEntry_createdAt_idx" ON "PrivilegedAuditEntry"("createdAt");

-- CreateIndex
CREATE INDEX "PrivilegedAuditEntry_resourceType_resourceId_idx" ON "PrivilegedAuditEntry"("resourceType", "resourceId");
