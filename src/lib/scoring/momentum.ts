import type { Bar, MomentumFeatures, MomentumResult } from "../types";
import type { ScreenerConfig } from "@config/screener.config";
import { closes, periodReturn, rsi, sma, TRADING_DAYS as T } from "../indicators";
import { percentileRanks } from "./percentile";

export interface MomentumInput { symbol: string; bars: Bar[] }

/** Features from bars sorted ascending by date. Returns null if history is too short. */
export function computeFeatures(bars: Bar[], spyRet6m: number): MomentumFeatures | null {
  if (bars.length < T.y1 + 1) return null;
  const c = closes(bars);
  const ret12_1 = periodReturn(c, T.y1, T.m1);
  const ret6m = periodReturn(c, T.m6);
  const ret3m = periodReturn(c, T.m3);
  const sma50 = sma(c, 50), sma200 = sma(c, 200), rsi14 = rsi(c, 14);
  if (ret12_1 == null || ret6m == null || ret3m == null || sma50 == null || sma200 == null || rsi14 == null) return null;
  const last = c[c.length - 1];
  const hi = Math.max(...bars.slice(-T.y1).map((b) => b.high));
  const v30 = bars.slice(-30);
  const avgDollarVol30d = v30.reduce((s, b) => s + b.close * b.volume, 0) / v30.length;
  return {
    ret12_1, ret6m, ret3m, rsVsSpy6m: ret6m - spyRet6m,
    high52Proximity: last / hi, sma50, sma200, rsi14, close: last,
    aboveMAs: last > sma50 && last > sma200, avgDollarVol30d,
  };
}

type MW = ScreenerConfig["momentum"]["weights"];
const KEYS: (keyof MW)[] = ["ret12_1", "ret6m", "ret3m", "rsVsSpy6m", "high52Proximity"];

/**
 * Percentile-ranks every feature across the whole eligible universe, combines with weights
 * (normalised to sum 1) and sorts by score. The MA gate is applied AFTER ranking so percentiles
 * reflect the full universe; the pool is the top `poolSize` that pass the gate.
 */
export function scoreMomentum(
  inputs: MomentumInput[], spyBars: Bar[], cfg: ScreenerConfig["momentum"],
): { all: MomentumResult[]; pool: MomentumResult[]; skipped: string[] } {
  const spyRet6m = periodReturn(closes(spyBars), T.m6) ?? 0;
  const feats: { symbol: string; f: MomentumFeatures }[] = [];
  const skipped: string[] = [];
  for (const i of inputs) {
    const f = computeFeatures(i.bars, spyRet6m);
    if (f) feats.push({ symbol: i.symbol, f });
    else skipped.push(i.symbol);
  }
  const wSum = KEYS.reduce((s, k) => s + cfg.weights[k], 0);
  const pct = Object.fromEntries(KEYS.map((k) => [k, percentileRanks(feats.map((x) => x.f[k]))])) as Record<keyof MW, number[]>;
  const all = feats
    .map((x, idx) => ({
      symbol: x.symbol, features: x.f,
      score: KEYS.reduce((s, k) => s + cfg.weights[k] * pct[k][idx], 0) / wSum,
    }))
    .sort((a, b) => b.score - a.score);
  const pool = all.filter((r) => !cfg.requireAboveMAs || r.features.aboveMAs).slice(0, cfg.poolSize);
  return { all, pool, skipped };
}
