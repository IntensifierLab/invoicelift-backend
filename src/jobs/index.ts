import { config } from "../config/env.js";
import type { DrawdownOrchestratorDeps } from "../services/drawdownOrchestrator.js";
import { runMonitorTick } from "./monitorFacilities.js";

export interface FacilityMonitorHandle {
  stop(): void;
  triggerNow(): Promise<void>;
}

export function startFacilityMonitor(deps: DrawdownOrchestratorDeps): FacilityMonitorHandle {
  const intervalMs = config.monitorIntervalMinutes * 60_000;
  let running = false;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runMonitorTick(deps);
    } finally {
      running = false;
    }
  };

  const handle = setInterval(() => {
    void tick();
  }, intervalMs);

  return {
    stop: () => clearInterval(handle),
    triggerNow: tick,
  };
}
