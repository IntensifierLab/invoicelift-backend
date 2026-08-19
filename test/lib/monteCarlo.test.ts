import { describe, expect, it } from "vitest";
import { buildHistogram, runSimulation } from "../../src/lib/monteCarlo.js";

describe("runSimulation", () => {
  it("is deterministic for a given seed", () => {
    const params = {
      defaultRate: 0.05,
      correlation: 0.2,
      poolSize: 100,
      feePct: 0.03,
      trials: 500,
      seed: 42,
    };
    const a = runSimulation(params);
    const b = runSimulation(params);
    expect(a.valueAtRisk).toBe(b.valueAtRisk);
    expect(a.lossDistribution).toEqual(b.lossDistribution);
  });

  it("produces VaR <= CVaR <= maxDrawdown, all within [0, 1]", () => {
    const result = runSimulation({
      defaultRate: 0.05,
      correlation: 0.2,
      poolSize: 200,
      feePct: 0.03,
      trials: 2000,
      seed: 7,
    });
    expect(result.valueAtRisk).toBeGreaterThanOrEqual(0);
    expect(result.valueAtRisk).toBeLessThanOrEqual(result.conditionalValueAtRisk);
    expect(result.conditionalValueAtRisk).toBeLessThanOrEqual(result.maxDrawdown);
    expect(result.maxDrawdown).toBeLessThanOrEqual(1);
  });

  it("higher correlation widens the loss distribution (fatter tail) for the same mean default rate", () => {
    const low = runSimulation({
      defaultRate: 0.05,
      correlation: 0.01,
      poolSize: 300,
      feePct: 0,
      trials: 4000,
      seed: 123,
    });
    const high = runSimulation({
      defaultRate: 0.05,
      correlation: 0.6,
      poolSize: 300,
      feePct: 0,
      trials: 4000,
      seed: 123,
    });
    // Same systemic-factor draws (same seed) but higher correlation should
    // produce a more extreme tail loss.
    expect(high.maxDrawdown).toBeGreaterThanOrEqual(low.maxDrawdown);
  });

  it("rejects out-of-range parameters", () => {
    const base = { defaultRate: 0.05, correlation: 0.2, poolSize: 100, feePct: 0.03 };
    expect(() => runSimulation({ ...base, defaultRate: 0 })).toThrow();
    expect(() => runSimulation({ ...base, defaultRate: 1 })).toThrow();
    expect(() => runSimulation({ ...base, correlation: 1 })).toThrow();
    expect(() => runSimulation({ ...base, correlation: -0.1 })).toThrow();
    expect(() => runSimulation({ ...base, poolSize: 0 })).toThrow();
  });

  it("lenderNetReturn is fee minus mean loss", () => {
    const result = runSimulation({
      defaultRate: 0.05,
      correlation: 0.1,
      poolSize: 500,
      feePct: 0.04,
      trials: 3000,
      seed: 9,
    });
    const meanLoss =
      result.lossDistribution.reduce((s, x) => s + x, 0) / result.lossDistribution.length;
    expect(result.lenderNetReturn).toBeCloseTo(0.04 - meanLoss, 10);
  });
});

describe("buildHistogram", () => {
  it("buckets values into the requested number of buckets covering the full range", () => {
    const histogram = buildHistogram([0, 0.1, 0.2, 0.5, 1], 5);
    expect(histogram).toHaveLength(5);
    expect(histogram.reduce((sum, b) => sum + b.count, 0)).toBe(5);
    expect(histogram[0].from).toBe(0);
    expect(histogram[histogram.length - 1].to).toBe(1);
  });

  it("returns an empty array for an empty distribution", () => {
    expect(buildHistogram([], 10)).toEqual([]);
  });
});
