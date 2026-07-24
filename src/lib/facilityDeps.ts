import type { DrawdownOrchestratorDeps } from "../services/drawdownOrchestrator.js";
import { createOnChainClient } from "./onChainClient.js";
import { DbPoolStateProvider } from "./poolStateProvider.js";
import { prisma } from "./prisma.js";
import { createReinsurerClient } from "./reinsurerClient.js";

export const facilityDeps: DrawdownOrchestratorDeps = {
  prisma,
  poolStateProvider: new DbPoolStateProvider(prisma),
  reinsurerClient: createReinsurerClient(),
  onChainClient: createOnChainClient(),
};
