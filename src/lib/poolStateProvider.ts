import type { PrismaClient } from "@prisma/client";

export interface PoolState {
  poolId: string;
  totalCapital: number;
  utilisedCapital: number;
  utilisationRatio: number;
}

export interface PoolStateProvider {
  getPoolState(poolId: string): Promise<PoolState>;
}

/**
 * Reads pool utilisation from the local Pool table. Stands in for a real
 * pool-manager contract reader until one is implemented; swap the
 * implementation behind this same interface when that lands.
 */
export class DbPoolStateProvider implements PoolStateProvider {
  constructor(private readonly prisma: PrismaClient) {}

  async getPoolState(poolId: string): Promise<PoolState> {
    const pool = await this.prisma.pool.findUnique({ where: { poolId } });
    if (!pool) {
      throw new Error(`No pool state found for poolId "${poolId}"`);
    }

    return {
      poolId: pool.poolId,
      totalCapital: pool.totalCapital,
      utilisedCapital: pool.utilisedCapital,
      utilisationRatio: pool.totalCapital === 0 ? 0 : pool.utilisedCapital / pool.totalCapital,
    };
  }
}
