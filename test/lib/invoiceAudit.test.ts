import { beforeEach, describe, expect, it } from "vitest";
import { facilityDeps } from "../../src/lib/facilityDeps.js";
import { recordInvoiceAudit } from "../../src/lib/invoiceAudit.js";
import { resetDb } from "../dbHelpers.js";

const prisma = facilityDeps.prisma;

async function createTestInvoice() {
  return prisma.invoice.create({
    data: {
      reference: `INV-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      smeAddress: "GSME000000000000000000000000000000000000000000000000",
      buyerAddress: "GBUYER00000000000000000000000000000000000000000000000",
      amount: 1000,
      dueDate: new Date("2026-09-01T00:00:00.000Z"),
      invoiceHash: "deadbeef",
    },
  });
}

describe("recordInvoiceAudit", () => {
  beforeEach(async () => {
    await resetDb(prisma);
  });

  it("persists an audit entry with the given action, actor, and detail", async () => {
    const invoice = await createTestInvoice();

    await recordInvoiceAudit(prisma, {
      action: "INVOICE_CREATED",
      actor: "api:test",
      invoiceId: invoice.id,
      detail: { reference: invoice.reference },
    });

    const entries = await prisma.invoiceAuditEntry.findMany({ where: { invoiceId: invoice.id } });
    expect(entries).toHaveLength(1);
    expect(entries[0].action).toBe("INVOICE_CREATED");
    expect(entries[0].actor).toBe("api:test");
    expect(entries[0].detail).toEqual({ reference: invoice.reference });
  });

  it("appends rather than overwrites when called multiple times for the same invoice", async () => {
    const invoice = await createTestInvoice();

    await recordInvoiceAudit(prisma, {
      action: "INVOICE_CREATED",
      actor: "api:test",
      invoiceId: invoice.id,
      detail: {},
    });
    await recordInvoiceAudit(prisma, {
      action: "SME_SIGNATURE_VERIFIED",
      actor: "api:test",
      invoiceId: invoice.id,
      detail: { signedAt: "2026-08-18T00:00:00.000Z" },
    });

    const entries = await prisma.invoiceAuditEntry.findMany({
      where: { invoiceId: invoice.id },
      orderBy: { createdAt: "asc" },
    });
    expect(entries.map((e) => e.action)).toEqual(["INVOICE_CREATED", "SME_SIGNATURE_VERIFIED"]);
  });

  it("rejects an audit entry for a non-existent invoice (foreign key enforced)", async () => {
    await expect(
      recordInvoiceAudit(prisma, {
        action: "INVOICE_CREATED",
        actor: "api:test",
        invoiceId: "does-not-exist",
        detail: {},
      }),
    ).rejects.toThrow();
  });
});
