import type { FastifyPluginAsync } from "fastify";
import { accountingIntegrationRoutes } from "./accountingIntegrations.js";
import { privilegedAuditRoutes } from "./privilegedAudit.js";
import { auditRoutes } from "./audit.js";
import { simulationRoutes } from "./simulations.js";
import { drawdownRoutes } from "./drawdowns.js";
import { regulatoryExportRoutes } from "./regulatoryExports.js";
import { invoiceRoutes } from "./invoices.js";
import { reconciliationRoutes } from "./reconciliation.js";
import { kycRoutes } from "./kyc.js";
import { invoiceZkProofRoutes } from "./invoiceZkProofs.js";
import { poolRoutes } from "./pools.js";
import { riskAnalyticsRoutes } from "./riskAnalytics.js";
import { notificationRoutes } from "./notifications.js";
import { treatyRoutes } from "./treaties.js";
import { delinquencyRoutes } from "./delinquency.js";
import { repaymentRoutes } from "./repayments.js";
import { partnerRoutes } from "./partners.js";
import { jobsAdminRoutes } from "./jobsAdmin.js";

export const v1Routes: FastifyPluginAsync = async (app) => {
  app.get("/meta", async () => ({
    name: "invoicelift-api",
    version: "0.1.0",
    description: "REST facade for Soroban contracts and indexers (scaffold).",
  }));

  await app.register(treatyRoutes);
  await app.register(privilegedAuditRoutes);
  await app.register(drawdownRoutes);
  await app.register(simulationRoutes);
  await app.register(auditRoutes);
  await app.register(regulatoryExportRoutes);
  await app.register(invoiceRoutes);
  await app.register(reconciliationRoutes);
  await app.register(poolRoutes);
  await app.register(invoiceZkProofRoutes);
  await app.register(riskAnalyticsRoutes);
  await app.register(notificationRoutes);
  await app.register(kycRoutes);
  await app.register(accountingIntegrationRoutes);

  await app.register(delinquencyRoutes);
  await app.register(repaymentRoutes);
  await app.register(partnerRoutes);
  await app.register(jobsAdminRoutes);
};

// Contribution check by robert-j at 2024-11-18T13:22:45

// Contribution check by james-t at 2025-02-22T18:53:47

// Contribution check by sambuilder at 2025-05-30T00:24:49

// Contribution check by robert-j at 2025-09-03T05:55:51

// Contribution check by james-t at 2025-12-08T11:26:53

// Contribution check by sambuilder at 2026-03-14T16:57:55

// Contribution by codemagician1949 — 2024-12-07

// Contribution by WIAG1949 — 2025-01-29

// Contribution by kulayddon — 2025-03-24

// Contribution by CelestinaBeing — 2025-05-16

// Contribution by joelpeace48-cell — 2025-07-08

// Contribution by Williams-1604 — 2025-08-31

// Contribution by codemagician1949 — 2025-10-23

// Contribution by WIAG1949 — 2025-12-15

// Contribution by kulayddon — 2026-02-07

// Contribution by CelestinaBeing — 2026-04-01

// Contribution by joelpeace48-cell — 2026-05-25
