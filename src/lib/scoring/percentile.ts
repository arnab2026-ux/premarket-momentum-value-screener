/** Percentile rank of x within values, 0-100 (mid-rank for ties). */
export function percentileRank(values: number[], x: number): number {
  if (values.length === 0) return 50;
  let less = 0, eq = 0;
  for (const v of values) {
    if (v < x) less++;
    else if (v === x) eq++;
  }
  return ((less + 0.5 * eq) / values.length) * 100;
}

export function percentileRanks(values: number[]): number[] {
  return values.map((v) => percentileRank(values, v));
}
