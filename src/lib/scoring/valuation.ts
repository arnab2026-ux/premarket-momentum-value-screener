import type { Fundamentals, Metrics, MetricKey, ValuationResult } from "../types";
import type { ScreenerConfig } from "@config/screener.config";
import { percentileRank } from "./percentile";

type VCfg = ScreenerConfig["valuation"];

export const isFinancialSector = (sector: string, cfg: VCfg) =>
  cfg.financialSectors.some((s) => s.toLowerCase() === sector.toLowerCase());

/** Metric set for a stock; financials/REITs use the swapped set (P/B, P/FFO or trailing P/E). */
export function buildMetrics(f: Fundamentals, financial: boolean): Metrics {
  const fwdPE = f.fwdEps && f.fwdEps > 0 && f.price ? f.price / f.fwdEps : null;
  if (financial) {
    return { fwdPE, pb: f.pb ?? null, pffoOrPe: f.isReit && f.pffo ? f.pffo : f.pe ?? null, peg: f.peg ?? null };
  }
  return { fwdPE, evEbitda: f.evEbitda ?? null, pFcf: f.pFcf ?? null, evSales: f.evSales ?? null, peg: f.peg ?? null };
}

const valid = (v: number | null | undefined, max: number): v is number =>
  v != null && Number.isFinite(v) && v > 0 && v <= max;

export interface ValuationInput { symbol: string; sector: string; metrics: Metrics }

/**
 * Per-metric percentile vs sector peers (lower multiple => higher score), then a weighted average over
 * the valid metrics with weights re-normalised. Fewer than minValidMetrics => score null (excluded).
 * Sectors with fewer than minPeers valid values for a metric fall back to the whole input set.
 */
export function scoreValuation(inputs: ValuationInput[], cfg: VCfg): ValuationResult[] {
  const bySector = new Map<string, ValuationInput[]>();
  for (const i of inputs) bySector.set(i.sector, [...(bySector.get(i.sector) ?? []), i]);

  const pick = (list: ValuationInput[], key: MetricKey) =>
    list.map((x) => x.metrics[key]).filter((v): v is number => valid(v, cfg.maxMultiple));
  const peerValues = (sector: string, key: MetricKey): number[] => {
    const s = pick(bySector.get(sector) ?? [], key);
    return s.length >= cfg.minPeers ? s : pick(inputs, key);
  };

  return inputs.map((i) => {
    const weights = (isFinancialSector(i.sector, cfg) ? cfg.financialWeights : cfg.weights) as Partial<Record<MetricKey, number>>;
    const pcts: Partial<Record<MetricKey, number>> = {};
    let wSum = 0, acc = 0;
    for (const [key, w] of Object.entries(weights) as [MetricKey, number][]) {
      const v = i.metrics[key];
      if (!valid(v, cfg.maxMultiple)) continue;
      const p = 100 - percentileRank(peerValues(i.sector, key), v); // cheap => high
      pcts[key] = p; wSum += w; acc += w * p;
    }
    const n = Object.keys(pcts).length;
    if (n < cfg.minValidMetrics) {
      return { symbol: i.symbol, score: null, validMetrics: n, metricPercentiles: pcts, excludedReason: `only ${n} valid valuation metrics` };
    }
    return { symbol: i.symbol, score: acc / wSum, validMetrics: n, metricPercentiles: pcts };
  });
}
