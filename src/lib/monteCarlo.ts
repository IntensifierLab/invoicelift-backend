/**
 * Monte Carlo pool-drawdown simulation.
 *
 * Uses a single-factor Gaussian copula (the standard actuarial/credit-risk
 * technique for correlated defaults, e.g. as in Basel's ASRF model): each
 * obligor's default is driven by a shared systemic factor Z plus an
 * idiosyncratic factor, so `correlation` controls how much obligors' fates
 * move together instead of failing independently. This is a real,
 * textbook-standard model — not a placeholder — chosen because it needs no
 * external dependency (just a normal sampler and its inverse CDF, both
 * implemented below) and is the right level of sophistication for a pool
 * sizing/risk-parameter sanity check, which is what this endpoint is for.
 */

export interface SimulationParams {
  /** Per-obligor probability of default over the horizon, e.g. 0.03 for 3%. */
  defaultRate: number;
  /** Asset correlation between obligors, in [0, 1). 0 = independent defaults. */
  correlation: number;
  /** Number of obligors (invoices/buyers) in the pool. */
  poolSize: number;
  /** Fee charged to the pool, as a fraction of capital, e.g. 0.02 for 2%. */
  feePct: number;
  /** Loss given default, as a fraction of an obligor's exposure. Defaults to 1 (total loss). */
  lossGivenDefault?: number;
  trials?: number;
  /** VaR/CVaR confidence level, e.g. 0.95. */
  confidenceLevel?: number;
  /** Deterministic seed for reproducible results (tests, "explain this simulation"). */
  seed?: number;
}

export interface SimulationResult {
  params: Required<SimulationParams>;
  valueAtRisk: number;
  conditionalValueAtRisk: number;
  maxDrawdown: number;
  lenderNetReturn: number;
  lossDistribution: number[];
}

// Mulberry32 — small, fast, deterministic PRNG so a `seed` gives byte-identical
// results across runs (Math.random() cannot be seeded).
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function standardNormal(rand: () => number): number {
  // Box-Muller transform.
  let u = 0;
  let v = 0;
  while (u === 0) u = rand();
  while (v === 0) v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// Acklam's rational approximation of the inverse standard normal CDF
// (probit function). Accurate to ~1.15e-9, more than sufficient here.
function inverseNormalCdf(p: number): number {
  if (p <= 0 || p >= 1) {
    throw new RangeError("inverseNormalCdf: p must be in (0, 1)");
  }
  const a = [
    -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2,
    -3.066479806614716e1, 2.506628277459239,
  ];
  const b = [
    -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1,
    -1.328068155288572e1,
  ];
  const c = [
    -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734,
    4.374664141464968, 2.938163982698783,
  ];
  const d = [
    7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416,
  ];
  const pLow = 0.02425;
  if (p < pLow) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }
  if (p <= 1 - pLow) {
    const q = p - 0.5;
    const r = q * q;
    return (
      ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
    );
  }
  const q = Math.sqrt(-2 * Math.log(1 - p));
  return -(
    (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
    ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
  );
}

export function runSimulation(input: SimulationParams): SimulationResult {
  if (input.defaultRate <= 0 || input.defaultRate >= 1) {
    throw new RangeError("defaultRate must be in (0, 1)");
  }
  if (input.correlation < 0 || input.correlation >= 1) {
    throw new RangeError("correlation must be in [0, 1)");
  }
  if (input.poolSize <= 0) {
    throw new RangeError("poolSize must be positive");
  }

  const params: Required<SimulationParams> = {
    defaultRate: input.defaultRate,
    correlation: input.correlation,
    poolSize: input.poolSize,
    feePct: input.feePct,
    lossGivenDefault: input.lossGivenDefault ?? 1,
    trials: input.trials ?? 10_000,
    confidenceLevel: input.confidenceLevel ?? 0.95,
    seed: input.seed ?? Date.now(),
  };

  const rand = mulberry32(params.seed);
  const rho = Math.sqrt(params.correlation);
  const idio = Math.sqrt(1 - params.correlation);
  const threshold = inverseNormalCdf(params.defaultRate);
  const exposurePerObligor = 1 / params.poolSize;

  const lossDistribution: number[] = new Array(params.trials);
  for (let t = 0; t < params.trials; t++) {
    const systemic = standardNormal(rand);
    let defaults = 0;
    for (let i = 0; i < params.poolSize; i++) {
      const latent = rho * systemic + idio * standardNormal(rand);
      if (latent < threshold) defaults++;
    }
    lossDistribution[t] = defaults * exposurePerObligor * params.lossGivenDefault;
  }

  const sorted = [...lossDistribution].sort((a, b) => a - b);
  const varIndex = Math.min(
    sorted.length - 1,
    Math.floor(params.confidenceLevel * sorted.length),
  );
  const valueAtRisk = sorted[varIndex];

  const tail = sorted.slice(varIndex);
  const conditionalValueAtRisk = tail.reduce((sum, x) => sum + x, 0) / tail.length;

  const maxDrawdown = sorted[sorted.length - 1];
  const meanLoss = lossDistribution.reduce((sum, x) => sum + x, 0) / lossDistribution.length;
  const lenderNetReturn = params.feePct - meanLoss;

  return {
    params,
    valueAtRisk,
    conditionalValueAtRisk,
    maxDrawdown,
    lenderNetReturn,
    lossDistribution,
  };
}

/** Buckets the loss distribution into a histogram for chart rendering, without shipping every raw trial to the client. */
export function buildHistogram(
  lossDistribution: number[],
  buckets = 20,
): Array<{ from: number; to: number; count: number }> {
  if (lossDistribution.length === 0) return [];
  const min = Math.min(...lossDistribution);
  const max = Math.max(...lossDistribution);
  const width = (max - min) / buckets || 1;

  const histogram = Array.from({ length: buckets }, (_, i) => ({
    from: min + i * width,
    to: min + (i + 1) * width,
    count: 0,
  }));

  for (const loss of lossDistribution) {
    const idx = Math.min(buckets - 1, Math.floor((loss - min) / width));
    histogram[idx].count++;
  }
  return histogram;
}
