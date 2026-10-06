import type { MetricKey, ReportRow } from "../types";

const LABEL: Record<MetricKey, string> = {
  fwdPE: "Fwd P/E", evEbitda: "EV/EBITDA", pFcf: "P/FCF", evSales: "EV/Sales", peg: "PEG", pb: "P/B", pffoOrPe: "P/FFO or P/E",
};

export interface WhyInput {
  momentumScore: number; valuationScore: number; ret6m: number; pctFromHigh: number;
  metricPercentiles: Partial<Record<MetricKey, number>>;
  metricValues: Partial<Record<MetricKey, number | null>>;
}

/** One-line, data-derived rationale. */
export function whyLine(w: WhyInput): string {
  const best = (Object.entries(w.metricPercentiles) as [MetricKey, number][]).sort((a, b) => b[1] - a[1])[0];
  const parts = [
    `Momentum ${w.momentumScore.toFixed(0)}/100 (6m ${w.ret6m >= 0 ? "+" : ""}${(w.ret6m * 100).toFixed(0)}%, ${w.pctFromHigh.toFixed(0)}% below 52w high)`,
  ];
  if (best) {
    const v = w.metricValues[best[0]];
    parts.push(`valuation ${w.valuationScore.toFixed(0)}/100, cheapest on ${LABEL[best[0]]}${v ? ` ${v.toFixed(1)}x` : ""} (cheaper than ${best[1].toFixed(0)}% of peers)`);
  }
  return parts.join("; ") + ".";
}

export function flagsFor(
  r: Pick<ReportRow, "nextEarnings" | "preMarketPct" | "rsi">, runDate: string, gapPct: number, rsiMax: number,
  addDays: (d: string, n: number) => string,
): string[] {
  const flags: string[] = [];
  if (r.nextEarnings === runDate) flags.push("Earnings TODAY");
  else if (r.nextEarnings && r.nextEarnings > runDate && r.nextEarnings <= addDays(runDate, 7)) flags.push(`Earnings ${r.nextEarnings}`);
  if (r.preMarketPct != null && Math.abs(r.preMarketPct) > gapPct) flags.push(`Gap ${r.preMarketPct > 0 ? "+" : ""}${r.preMarketPct.toFixed(1)}%`);
  if (r.rsi > rsiMax) flags.push("Overextended RSI");
  return flags;
}
