import { config } from "../config/env.js";
import type { DrawdownOrchestratorDeps } from "../services/drawdownOrchestrator.js";
import { createOnChainClient } from "./onChainClient.js";
import { CachedPoolStateProvider, DbPoolStateProvider } from "./poolStateProvider.js";
import { prisma } from "./prisma.js";
import { createReinsurerClient } from "./reinsurerClient.js";

export const facilityDeps: DrawdownOrchestratorDeps = {
  prisma,
  poolStateProvider: new CachedPoolStateProvider(
    new DbPoolStateProvider(prisma),
    config.poolStateCacheTtlMs,
  ),
  reinsurerClient: createReinsurerClient(),
  onChainClient: createOnChainClient(prisma),
};
