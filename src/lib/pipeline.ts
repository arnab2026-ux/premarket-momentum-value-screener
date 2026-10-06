import type { MarketDataProvider, MetricKey, Metrics, ReportData, ReportRow } from "./types";
import type { ScreenerConfig } from "@config/screener.config";
import { addDays, previousTradingDay } from "./calendar";
import { scoreMomentum } from "./scoring/momentum";
import { buildMetrics, isFinancialSector, scoreValuation } from "./scoring/valuation";
import { qualityRedFlag, selectTop } from "./scoring/ranking";
import { flagsFor, whyLine } from "./report/why";

export interface UniverseRow { symbol: string; name: string; sector: string; price: number | null; market_cap: number | null; adv_usd: number | null; passed_filters: boolean; reject_reason: string | null }
export interface ScoreRow {
  symbol: string; momentum_score: number | null; valuation_score: number | null; in_pool: boolean;
  final_rank: number | null; excluded_reason: string | null; features: unknown; metrics: unknown;
}
export interface PipelineResult { report: ReportData; universeRows: UniverseRow[]; scoreRows: ScoreRow[] }

export interface PipelineDeps {
  provider: MarketDataProvider; cfg: ScreenerConfig; runDate: string; previousTickers: string[];
  limit?: number; // smoke-test: cap the universe size
}

const pos = (v: number | null | undefined) => (v != null && v > 0 ? v : null);

export async function runPipeline({ provider, cfg, runDate, previousTickers, limit }: PipelineDeps): Promise<PipelineResult> {
  const lastClose = previousTradingDay(runDate);
  const from = addDays(runDate, -400);
  const warnings: string[] = [];
  const universeRows: UniverseRow[] = [];
  const reject = new Map<string, string>();

  // --- universe + basic filters --------------------------------------------------------------
  let members = await provider.getUniverse();
  members = members.filter((m) => cfg.universe.exchanges.includes(m.exchange.toUpperCase()) || m.exchange === "");
  if (limit) members = members.slice(0, limit);
  const byRaw = new Map(members.map((m) => [m.symbol, m]));
  const eligible = members.filter((m) => {
    if (m.price < cfg.universe.minPrice) reject.set(m.symbol, "price < min");
    else if (m.marketCap < cfg.universe.minMarketCap) reject.set(m.symbol, "market cap < min");
    return !reject.has(m.symbol);
  });

  // --- price history, liquidity + staleness filters --------------------------------------------
  const barsBySym = await provider.getDailyBars([...eligible.map((m) => m.symbol), "SPY"], from, lastClose);
  const spyBars = barsBySym.SPY ?? [];
  if (spyBars.length < 253) throw new Error("SPY history missing or too short; cannot compute relative strength");
  const advBySym = new Map<string, number>();
  const inputs: { symbol: string; bars: (typeof spyBars) }[] = [];
  for (const m of eligible) {
    const bars = (barsBySym[m.symbol] ?? []).filter((b) => b.date <= lastClose);
    if (!bars.length) { reject.set(m.symbol, "no price history"); warnings.push(`${m.symbol}: no price history`); continue; }
    if (bars.at(-1)!.date < addDays(lastClose, -4)) { reject.set(m.symbol, "stale prices"); warnings.push(`${m.symbol}: stale prices (last bar ${bars.at(-1)!.date})`); continue; }
    const v30 = bars.slice(-30);
    const adv = v30.reduce((s, b) => s + b.close * b.volume, 0) / v30.length;
    advBySym.set(m.symbol, adv);
    if (bars.at(-1)!.close < cfg.universe.minPrice) { reject.set(m.symbol, "price < min"); continue; }
    if (adv < cfg.universe.minAvgDollarVolume30d) { reject.set(m.symbol, "30d dollar volume < min"); continue; }
    if (bars.length < 253) { reject.set(m.symbol, "history < 253 bars"); continue; }
    inputs.push({ symbol: m.symbol, bars });
  }
  for (const m of members) {
    universeRows.push({
      symbol: m.symbol, name: m.name, sector: m.sector, price: m.price, market_cap: m.marketCap,
      adv_usd: advBySym.get(m.symbol) ?? null, passed_filters: !reject.has(m.symbol), reject_reason: reject.get(m.symbol) ?? null,
    });
  }

  // --- step 1: momentum ---------------------------------------------------------------------
  const mom = scoreMomentum(inputs, spyBars, cfg.momentum);
  if (mom.skipped.length) warnings.push(`${mom.skipped.length} symbols skipped: insufficient history for momentum`);
  const pool = mom.pool;
  const poolSyms = pool.map((p) => p.symbol);

  // --- step 2: valuation ---------------------------------------------------------------------
  const [fund, quotes, earnings, regime] = await Promise.all([
    provider.getFundamentals(poolSyms),
    provider.getQuotes(poolSyms),
    provider.getEarningsDates(poolSyms, runDate, addDays(runDate, 90)),
    provider.getMarketRegime(),
  ]);
  const valInputs = pool.map((p) => {
    const m = byRaw.get(p.symbol)!;
    const f = fund[p.symbol];
    if (!f) warnings.push(`${p.symbol}: no fundamentals`);
    const full = f ? { ...f, price: p.features.close, isReit: m.sector === "Real Estate" } : undefined;
    return { symbol: p.symbol, sector: m.sector, metrics: full ? buildMetrics(full, isFinancialSector(m.sector, cfg.valuation)) : ({} as Metrics) };
  });
  const val = new Map(scoreValuation(valInputs, cfg.valuation).map((v) => [v.symbol, v]));
  const metricsBySym = new Map(valInputs.map((v) => [v.symbol, v.metrics]));

  // --- step 3: guards + final ranking ------------------------------------------------------------
  const excluded = new Map<string, string>();
  const candidates = pool.flatMap((p) => {
    const m = byRaw.get(p.symbol)!, v = val.get(p.symbol)!;
    if (v.score == null) { excluded.set(p.symbol, v.excludedReason ?? "no valuation"); return []; }
    const flag = qualityRedFlag(fund[p.symbol], m.sector, cfg);
    if (flag) { excluded.set(p.symbol, flag); return []; }
    return [{ symbol: p.symbol, sector: m.sector, valuationScore: v.score, momentumScore: p.score }];
  });
  const top = selectTop(candidates, cfg.ranking);
  const topSet = new Set(top.map((t) => t.symbol));
  for (const c of candidates) if (!topSet.has(c.symbol)) excluded.set(c.symbol, "outside top N / sector cap");

  const rows: ReportRow[] = top.map((t, i) => {
    const m = byRaw.get(t.symbol)!, p = pool.find((x) => x.symbol === t.symbol)!, q = quotes[t.symbol];
    const met = metricsBySym.get(t.symbol) ?? {};
    const preMarketPct = q?.preMarketPrice != null && q.previousClose > 0 ? (q.preMarketPrice / q.previousClose - 1) * 100 : null;
    if (!q) warnings.push(`${t.symbol}: no quote`);
    const base = {
      rank: i + 1, symbol: t.symbol, name: m.name, sector: m.sector, price: q?.price ?? p.features.close, preMarketPct,
      momentumScore: t.momentumScore, valuationScore: t.valuationScore,
      fwdPE: pos(met.fwdPE), evEbitda: pos(met.evEbitda), pFcf: pos(met.pFcf), // negative multiples are meaningless -> shown as "–"
      ret6m: p.features.ret6m, pctFromHigh: (1 - p.features.high52Proximity) * 100, rsi: p.features.rsi14,
      nextEarnings: earnings[t.symbol] ?? null,
    };
    return {
      ...base,
      why: whyLine({
        momentumScore: t.momentumScore, valuationScore: t.valuationScore, ret6m: base.ret6m, pctFromHigh: base.pctFromHigh,
        metricPercentiles: val.get(t.symbol)!.metricPercentiles, metricValues: met as Partial<Record<MetricKey, number | null>>,
      }),
      flags: flagsFor(base, runDate, cfg.ranking.gapFlagPct, cfg.momentum.rsiOverextended, addDays),
    };
  });

  const nowSet = new Set(rows.map((r) => r.symbol)), prevSet = new Set(previousTickers);
  const rankOf = new Map(rows.map((r) => [r.symbol, r.rank]));
  const scoreRows: ScoreRow[] = mom.all.map((a) => ({
    symbol: a.symbol, momentum_score: a.score, valuation_score: val.get(a.symbol)?.score ?? null,
    in_pool: poolSyms.includes(a.symbol), final_rank: rankOf.get(a.symbol) ?? null,
    excluded_reason: excluded.get(a.symbol) ?? (poolSyms.includes(a.symbol) ? null : a.features.aboveMAs ? "below momentum pool cutoff" : "below 50/200-day MA"),
    features: a.features, metrics: { metrics: metricsBySym.get(a.symbol) ?? null, percentiles: val.get(a.symbol)?.metricPercentiles ?? null },
  }));

  return {
    report: {
      runDate, generatedAt: new Date().toISOString(), dataTimestamp: `${lastClose} close + pre-market quotes at run time`,
      regime, rows,
      newEntrants: previousTickers.length ? rows.map((r) => r.symbol).filter((s) => !prevSet.has(s)) : [],
      droppedOut: previousTickers.filter((s) => !nowSet.has(s)),
      warnings: [...warnings, ...provider.warnings],
      isMock: provider.name === "mock",
    },
    universeRows, scoreRows,
  };
}
