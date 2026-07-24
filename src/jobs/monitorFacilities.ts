import { evaluateAndDraw, type DrawdownOrchestratorDeps } from "../services/drawdownOrchestrator.js";

const MONITOR_ACTOR = "system:monitor-job";

/**
 * Evaluates every active treaty once. A single treaty's failure does not
 * stop the loop — the orchestrator already records the failure to the audit
 * trail, so we just log and move on here.
 */
export async function runMonitorTick(deps: DrawdownOrchestratorDeps): Promise<void> {
  const treaties = await deps.prisma.treaty.findMany({ where: { status: "ACTIVE" } });

  for (const treaty of treaties) {
    try {
      await evaluateAndDraw(treaty, deps, MONITOR_ACTOR);
    } catch (err) {
      console.error(`Facility monitor tick failed for treaty ${treaty.id}:`, err);
    }
  }
}
