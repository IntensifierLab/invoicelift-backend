import { describe, expect, it } from "vitest";
import { CachedPoolStateProvider, type PoolState, type PoolStateProvider } from "../../src/lib/poolStateProvider.js";

function makeState(poolId: string, utilisedCapital: number): PoolState {
  return { poolId, totalCapital: 1000, utilisedCapital, utilisationRatio: utilisedCapital / 1000 };
}

function fakeInner(): PoolStateProvider & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async getPoolState(poolId: string) {
      calls.push(poolId);
      return makeState(poolId, calls.length * 10);
    },
  };
}

describe("CachedPoolStateProvider", () => {
  it("serves a cached value within the TTL instead of calling the inner provider again", async () => {
    const inner = fakeInner();
    let now = 0;
    const cached = new CachedPoolStateProvider(inner, 1000, () => now);

    const first = await cached.getPoolState("pool-1");
    const second = await cached.getPoolState("pool-1");

    expect(inner.calls).toHaveLength(1);
    expect(second).toEqual(first);
  });

  it("re-fetches once the TTL has elapsed", async () => {
    const inner = fakeInner();
    let now = 0;
    const cached = new CachedPoolStateProvider(inner, 1000, () => now);

    await cached.getPoolState("pool-1");
    now = 1001;
    await cached.getPoolState("pool-1");

    expect(inner.calls).toHaveLength(2);
  });

  it("caches independently per poolId", async () => {
    const inner = fakeInner();
    const cached = new CachedPoolStateProvider(inner, 1000, () => 0);

    await cached.getPoolState("pool-1");
    await cached.getPoolState("pool-2");
    await cached.getPoolState("pool-1");

    expect(inner.calls).toEqual(["pool-1", "pool-2"]);
  });

  it("does not cache a failed read, so the next call retries the inner provider", async () => {
    let attempt = 0;
    const inner: PoolStateProvider = {
      async getPoolState(poolId: string) {
        attempt++;
        if (attempt === 1) throw new Error("rpc unavailable");
        return makeState(poolId, 50);
      },
    };
    const cached = new CachedPoolStateProvider(inner, 1000, () => 0);

    await expect(cached.getPoolState("pool-1")).rejects.toThrow("rpc unavailable");
    const result = await cached.getPoolState("pool-1");

    expect(attempt).toBe(2);
    expect(result.utilisedCapital).toBe(50);
  });

  it("invalidate(poolId) forces the next read to bypass the cache", async () => {
    const inner = fakeInner();
    const cached = new CachedPoolStateProvider(inner, 100_000, () => 0);

    await cached.getPoolState("pool-1");
    cached.invalidate("pool-1");
    await cached.getPoolState("pool-1");

    expect(inner.calls).toHaveLength(2);
  });

  it("invalidate() with no argument clears every poolId's cached entry", async () => {
    const inner = fakeInner();
    const cached = new CachedPoolStateProvider(inner, 100_000, () => 0);

    await cached.getPoolState("pool-1");
    await cached.getPoolState("pool-2");
    cached.invalidate();
    await cached.getPoolState("pool-1");
    await cached.getPoolState("pool-2");

    expect(inner.calls).toHaveLength(4);
  });

  it("a zero TTL effectively disables caching", async () => {
    const inner = fakeInner();
    const cached = new CachedPoolStateProvider(inner, 0, () => Date.now());

    await cached.getPoolState("pool-1");
    await new Promise((resolve) => setTimeout(resolve, 1));
    await cached.getPoolState("pool-1");

    expect(inner.calls).toHaveLength(2);
  });
});
