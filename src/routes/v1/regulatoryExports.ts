import { RegulatoryExportFormat, RegulatoryReportType } from "@prisma/client";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { facilityDeps } from "../../lib/facilityDeps.js";
import { generateRegulatoryExport } from "../../lib/regulatoryExport.js";

const generateSchema = z.object({
  reportType: z.nativeEnum(RegulatoryReportType),
  format: z.nativeEnum(RegulatoryExportFormat),
  periodStart: z.coerce.date(),
  periodEnd: z.coerce.date(),
});

/** On-demand regulatory-grade report generation, plus fetch of previously generated (signed) exports. */
export const regulatoryExportRoutes: FastifyPluginAsync = async (app) => {
  app.post("/regulatory-exports", async (req, reply) => {
    const parsed = generateSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }
    if (parsed.data.periodEnd < parsed.data.periodStart) {
      return reply.status(400).send({ error: "periodEnd must not be before periodStart" });
    }

    const record = await generateRegulatoryExport(facilityDeps.prisma, parsed.data);
    return reply.status(201).send(record);
  });

  app.get("/regulatory-exports", async (req) => {
    const query = req.query as { reportType?: string };
    return facilityDeps.prisma.regulatoryExportRecord.findMany({
      where: query.reportType
        ? { reportType: query.reportType as RegulatoryReportType }
        : undefined,
      orderBy: { generatedAt: "desc" },
      select: {
        id: true,
        reportType: true,
        format: true,
        periodStart: true,
        periodEnd: true,
        generatedAt: true,
        signerPublicKey: true,
      },
    });
  });

  app.get("/regulatory-exports/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const record = await facilityDeps.prisma.regulatoryExportRecord.findUnique({ where: { id } });
    if (!record) return reply.status(404).send({ error: "export not found" });
    return record;
  });
};
