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

interface CacheEntry {
  value: PoolState;
  expiresAt: number;
}

/**
 * Wraps another PoolStateProvider with a short-lived, per-poolId TTL cache.
 * `DbPoolStateProvider` is a local stand-in today, but this decorator exists
 * for when it's swapped for a real Soroban RPC/contract reader — those reads
 * are comparatively expensive and rate-limited, and pool utilisation doesn't
 * need to be read fresh on every request (risk-analytics and drawdown
 * endpoints call it far more often than the underlying state actually
 * changes). A failed underlying read is never cached, and evicts any stale
 * entry for that poolId so the next call retries against the source rather
 * than being stuck failing silently until TTL expiry.
 */
export class CachedPoolStateProvider implements PoolStateProvider {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    private readonly inner: PoolStateProvider,
    private readonly ttlMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  async getPoolState(poolId: string): Promise<PoolState> {
    const cached = this.cache.get(poolId);
    const nowMs = this.now();
    if (cached && cached.expiresAt > nowMs) {
      return cached.value;
    }

    try {
      const value = await this.inner.getPoolState(poolId);
      this.cache.set(poolId, { value, expiresAt: nowMs + this.ttlMs });
      return value;
    } catch (err) {
      this.cache.delete(poolId);
      throw err;
    }
  }

  /** Drops one poolId's cached entry (or the whole cache) so the next read is forced fresh. */
  invalidate(poolId?: string): void {
    if (poolId) {
      this.cache.delete(poolId);
    } else {
      this.cache.clear();
    }
  }
}
