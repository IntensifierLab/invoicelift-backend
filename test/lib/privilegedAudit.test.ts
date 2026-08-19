import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  listPrivilegedAudit,
  recordPrivilegedAudit,
  signAuditExport,
  verifyAuditExportSignature,
} from "../../src/lib/privilegedAudit.js";
import { resetDb } from "../dbHelpers.js";

const prisma = new PrismaClient();

describe("privilegedAudit", () => {
  beforeEach(async () => {
    await resetDb(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("records an entry with before/after state and reads it back", async () => {
    await recordPrivilegedAudit(prisma, {
      category: "POOL",
      action: "POOL_CREATED",
      actor: "test:admin",
      resourceType: "Pool",
      resourceId: "pool-1",
      beforeState: null,
      afterState: { totalCapital: 100 },
    });

    const entries = await listPrivilegedAudit(prisma, {});
    expect(entries).toHaveLength(1);
    expect(entries[0].action).toBe("POOL_CREATED");
    expect(entries[0].afterState).toEqual({ totalCapital: 100 });
  });

  it("filters by actor, category, action, and date range", async () => {
    await recordPrivilegedAudit(prisma, {
      category: "POOL",
      action: "POOL_CREATED",
      actor: "actor-a",
      resourceType: "Pool",
      resourceId: "pool-1",
    });
    await recordPrivilegedAudit(prisma, {
      category: "INVOICE",
      action: "INVOICE_VERIFIED",
      actor: "actor-b",
      resourceType: "Invoice",
      resourceId: "inv-1",
    });

    expect(await listPrivilegedAudit(prisma, { actor: "actor-a" })).toHaveLength(1);
    expect(await listPrivilegedAudit(prisma, { category: "INVOICE" })).toHaveLength(1);
    expect(await listPrivilegedAudit(prisma, { action: "POOL_CREATED" })).toHaveLength(1);
    expect(
      await listPrivilegedAudit(prisma, { from: new Date(Date.now() + 60_000) }),
    ).toHaveLength(0);
  });

  it("produces a signed export whose signature verifies", async () => {
    await recordPrivilegedAudit(prisma, {
      category: "ADMIN",
      action: "SOMETHING_PRIVILEGED",
      actor: "actor-a",
      resourceType: "System",
      resourceId: "n/a",
    });
    const entries = await listPrivilegedAudit(prisma, {});

    const exported = signAuditExport(entries);
    expect(exported.entryCount).toBe(1);
    expect(verifyAuditExportSignature(exported)).toBe(true);
  });

  it("rejects a signed export whose content was tampered with after signing", () => {
    const exported = signAuditExport([{ action: "ORIGINAL" }]);
    const tampered = { ...exported, entries: [{ action: "TAMPERED" }] };
    expect(verifyAuditExportSignature(tampered)).toBe(false);
  });
});
