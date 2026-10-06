import type { Bar, HistoricalFundamentals, MarketDataProvider, Metrics } from "./types";
import type { ScreenerConfig } from "@config/screener.config";
import { addDays } from "./calendar";
import { scoreMomentum } from "./scoring/momentum";
import { isFinancialSector, scoreValuation } from "./scoring/valuation";
import { selectTop } from "./scoring/ranking";

export interface PerfStats { cagr: number; sharpe: number; maxDrawdown: number; hitRate: number; months: number; totalReturn: number; avgTurnover?: number }

export function perfStats(returns: number[], bench: number[]): PerfStats {
  const n = returns.length;
  const growth = returns.reduce((a, r) => a * (1 + r), 1);
  const mean = returns.reduce((a, r) => a + r, 0) / n;
  const sd = Math.sqrt(returns.reduce((a, r) => a + (r - mean) ** 2, 0) / Math.max(1, n - 1));
  let eq = 1, peak = 1, mdd = 0;
  for (const r of returns) { eq *= 1 + r; peak = Math.max(peak, eq); mdd = Math.min(mdd, eq / peak - 1); }
  return {
    cagr: growth ** (12 / n) - 1, sharpe: sd > 0 ? (mean / sd) * Math.sqrt(12) : 0, maxDrawdown: mdd,
    hitRate: returns.filter((r, i) => r > bench[i]).length / n, months: n, totalReturn: growth - 1,
  };
}

const idxOnOrBefore = (bars: Bar[], date: string) => {
  let lo = 0, hi = bars.length - 1, ans = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (bars[mid].date <= date) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
  return ans;
};

/** Metrics usable as-of `date` from quarterly history (trailing P/E stands in for forward P/E). */
function asOfMetrics(hist: HistoricalFundamentals[] | undefined, date: string, financial: boolean): { m: Metrics; lossMaking: boolean } | null {
  const h = hist?.filter((x) => x.date <= date).at(-1);
  if (!h) return null;
  const m: Metrics = financial
    ? { fwdPE: h.pe, pb: h.pb, pffoOrPe: h.pe, peg: h.peg }
    : { fwdPE: h.pe, evEbitda: h.evEbitda, pFcf: h.pFcf, evSales: h.evSales, peg: h.peg };
  return { m, lossMaking: (h.netIncome ?? 1) < 0 };
}

export interface BacktestResult {
  strategy: PerfStats; momentumOnly: PerfStats; spy: PerfStats;
  periods: { date: string; strategy: number; momentumOnly: number; spy: number; names: string[] }[];
  notes: string[];
}

export async function runBacktest(
  provider: MarketDataProvider, cfg: ScreenerConfig, opts: { endDate: string; years: number },
): Promise<BacktestResult> {
  const startDate = addDays(opts.endDate, -Math.round(opts.years * 365.25) - 400);
  const members = await provider.getUniverse();
  const sectorOf = new Map(members.map((m) => [m.symbol, m.sector]));
  const bars = await provider.getDailyBars([...members.map((m) => m.symbol), "SPY"], startDate, opts.endDate);
  const spy = bars.SPY;
  if (!spy?.length) throw new Error("no SPY history");
  const hist = provider.getHistoricalFundamentals ? await provider.getHistoricalFundamentals(members.map((m) => m.symbol)) : {};

  // month-end rebalance dates inside the test window
  const testStart = addDays(opts.endDate, -Math.round(opts.years * 365.25));
  const rebal: string[] = [];
  spy.forEach((b, i) => { if (b.date >= testStart && (i === spy.length - 1 || spy[i + 1].date.slice(0, 7) !== b.date.slice(0, 7))) rebal.push(b.date); });

  const periods: BacktestResult["periods"] = [];
  let prev = new Set<string>(), prevMo = new Set<string>();
  const turnovers: number[] = [];
  const cost = cfg.backtest.costBps / 1e4;

  for (let k = 0; k < rebal.length - 1; k++) {
    const t = rebal[k], t1 = rebal[k + 1];
    const inputs: { symbol: string; bars: Bar[] }[] = [];
    for (const m of members) {
      const b = bars[m.symbol];
      if (!b) continue;
      const i = idxOnOrBefore(b, t);
      if (i < 252) continue;
      const slice = b.slice(Math.max(0, i - 300), i + 1);
      const last = slice.at(-1)!;
      const adv = slice.slice(-30).reduce((s, x) => s + x.close * x.volume, 0) / 30;
      if (last.close < cfg.universe.minPrice || adv < cfg.universe.minAvgDollarVolume30d) continue;
      inputs.push({ symbol: m.symbol, bars: slice });
    }
    const spySlice = spy.slice(Math.max(0, idxOnOrBefore(spy, t) - 300), idxOnOrBefore(spy, t) + 1);
    const mom = scoreMomentum(inputs, spySlice, cfg.momentum);

    const valIn = mom.pool.flatMap((p) => {
      const sector = sectorOf.get(p.symbol)!;
      const am = asOfMetrics(hist[p.symbol], t, isFinancialSector(sector, cfg.valuation));
      return am && !am.lossMaking ? [{ symbol: p.symbol, sector, metrics: am.m }] : [];
    });
    const val = scoreValuation(valIn, cfg.valuation);
    const momScore = new Map(mom.pool.map((p) => [p.symbol, p.score]));
    const picks = selectTop(
      val.flatMap((v) => (v.score == null ? [] : [{ symbol: v.symbol, sector: sectorOf.get(v.symbol)!, valuationScore: v.score, momentumScore: momScore.get(v.symbol)! }])),
      cfg.ranking,
    ).map((c) => c.symbol);
    const momOnly = mom.pool.slice(0, cfg.ranking.topN).map((p) => p.symbol);

    const fwdRet = (syms: string[]) => {
      const rs = syms.map((s) => {
        const b = bars[s], i0 = idxOnOrBefore(b, t), i1 = idxOnOrBefore(b, t1);
        return b[i1].close / b[i0].close - 1;
      });
      return rs.length ? rs.reduce((a, r) => a + r, 0) / rs.length : 0;
    };
    const turn = (cur: string[], p: Set<string>) => (cur.length ? cur.filter((s) => !p.has(s)).length / cur.length : 0);
    const tv = turn(picks, prev); turnovers.push(tv);
    const sr = spy[idxOnOrBefore(spy, t1)].close / spy[idxOnOrBefore(spy, t)].close - 1;
    periods.push({
      date: t, strategy: fwdRet(picks) - tv * 2 * cost, momentumOnly: fwdRet(momOnly) - turn(momOnly, prevMo) * 2 * cost, spy: sr, names: picks,
    });
    prev = new Set(picks); prevMo = new Set(momOnly);
  }

  const spyR = periods.map((p) => p.spy);
  const strategy = perfStats(periods.map((p) => p.strategy), spyR);
  strategy.avgTurnover = turnovers.reduce((a, b) => a + b, 0) / turnovers.length;
  return {
    strategy, momentumOnly: perfStats(periods.map((p) => p.momentumOnly), spyR), spy: perfStats(spyR, spyR), periods,
    notes: [
      "Universe = today's constituents (survivorship bias: delisted/failed names are absent, flatters results).",
      "Valuation uses quarterly trailing ratios stamped period-end + 60d (approximate point-in-time); trailing P/E substitutes for forward P/E (no historical estimates).",
      "Market-cap filter is not applied historically. Equal weight, month-end close to month-end close, costs = bps per side on replaced names.",
    ],
  };
}
