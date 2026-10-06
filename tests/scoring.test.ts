import { describe, expect, it } from "vitest";
import { defaultConfig as cfg } from "@config/screener.config";
import type { Bar, Fundamentals } from "../src/lib/types";
import { rsi, sma, periodReturn } from "../src/lib/indicators";
import { percentileRank } from "../src/lib/scoring/percentile";
import { computeFeatures, scoreMomentum } from "../src/lib/scoring/momentum";
import { buildMetrics, scoreValuation } from "../src/lib/scoring/valuation";
import { qualityRedFlag, selectTop } from "../src/lib/scoring/ranking";
import { perfStats } from "../src/lib/backtest";
import { whyLine } from "../src/lib/report/why";

/** Fixture: N daily bars growing at a constant daily rate from `start`. */
const series = (n: number, start: number, daily: number): Bar[] =>
  Array.from({ length: n }, (_, i) => {
    const c = start * (1 + daily) ** i;
    return { date: `d${String(i).padStart(4, "0")}`, open: c, high: c * 1.001, low: c * 0.999, close: c, volume: 2_000_000 };
  });

describe("indicators", () => {
  it("sma of last n values", () => expect(sma([1, 2, 3, 4, 5], 3)).toBe(4));
  it("sma null when too short", () => expect(sma([1, 2], 3)).toBeNull());
  it("rsi is 100 for monotonic rise and 0 for monotonic fall", () => {
    const up = Array.from({ length: 40 }, (_, i) => 100 + i);
    expect(rsi(up)).toBe(100);
    expect(rsi([...up].reverse())).toBeCloseTo(0, 5);
  });
  it("rsi known value (Wilder example series)", () => {
    const px = [44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28];
    expect(rsi(px, 14)).toBeCloseTo(70.46, 1);
  });
  it("periodReturn skips the most recent month when lagEnd=21", () => {
    const v = Array.from({ length: 300 }, (_, i) => i + 1);
    expect(periodReturn(v, 252, 21)).toBeCloseTo(v[278] / v[47] - 1, 10);
  });
});

describe("percentileRank", () => {
  it("min/max/mid", () => {
    const v = [1, 2, 3, 4, 5];
    expect(percentileRank(v, 1)).toBe(10);
    expect(percentileRank(v, 5)).toBe(90);
    expect(percentileRank(v, 3)).toBe(50);
  });
});

describe("momentum", () => {
  const spy = series(300, 100, 0.0003);
  it("returns null with <253 bars", () => expect(computeFeatures(series(200, 10, 0.001), 0.05)).toBeNull());
  it("fast riser outranks slow riser; decliner fails MA gate", () => {
    const res = scoreMomentum(
      [
        { symbol: "FAST", bars: series(300, 50, 0.004) },
        { symbol: "SLOW", bars: series(300, 50, 0.001) },
        { symbol: "DOWN", bars: series(300, 50, -0.002) },
      ],
      spy, cfg.momentum,
    );
    expect(res.all.map((r) => r.symbol)).toEqual(["FAST", "SLOW", "DOWN"]);
    expect(res.pool.map((r) => r.symbol)).toEqual(["FAST", "SLOW"]); // DOWN is below its MAs
    expect(res.all[0].score).toBeGreaterThan(res.all[1].score);
    expect(res.all[0].features.rsVsSpy6m).toBeGreaterThan(0);
  });
  it("respects pool size", () => {
    const inputs = Array.from({ length: 10 }, (_, i) => ({ symbol: `S${i}`, bars: series(300, 50, 0.001 + i * 0.0002) }));
    expect(scoreMomentum(inputs, spy, { ...cfg.momentum, poolSize: 4 }).pool).toHaveLength(4);
  });
});

describe("valuation", () => {
  const mk = (symbol: string, sector: string, metrics: object) => ({ symbol, sector, metrics });
  const tech = (n: number) => Array.from({ length: n }, (_, i) =>
    mk(`T${i}`, "Technology", { fwdPE: 10 + i, evEbitda: 8 + i, pFcf: 12 + i, evSales: 2 + i, peg: 1 + i / 10 }));
  const vcfg = { ...cfg.valuation, minPeers: 5 };

  it("cheaper multiples score higher", () => {
    const r = scoreValuation(tech(10), vcfg);
    expect(r[0].score!).toBeGreaterThan(r[9].score!);
    expect(r[0].score!).toBeGreaterThan(90);
  });
  it("negative/zero metrics are dropped and weights re-normalised", () => {
    const base = tech(10);
    const dirty = [...base, mk("NEG", "Technology", { fwdPE: -5, evEbitda: 9, pFcf: 13, evSales: 3, peg: null })];
    const r = scoreValuation(dirty, vcfg).find((x) => x.symbol === "NEG")!;
    expect(r.validMetrics).toBe(3);
    expect(r.metricPercentiles.fwdPE).toBeUndefined();
    expect(r.score).not.toBeNull();
    expect(r.score!).toBeGreaterThan(0); expect(r.score!).toBeLessThanOrEqual(100);
  });
  it("excludes stock with <3 valid metrics", () => {
    const r = scoreValuation([...tech(10), mk("BAD", "Technology", { fwdPE: 12, evEbitda: -1 })], vcfg).find((x) => x.symbol === "BAD")!;
    expect(r.score).toBeNull();
    expect(r.excludedReason).toMatch(/valid/);
  });
  it("financials use P/B and P/E set, not EV/EBITDA", () => {
    const fin: Fundamentals = { symbol: "BANK", price: 100, fwdEps: 10, pb: 1.2, pe: 9, evEbitda: 5, pFcf: 7 };
    const m = buildMetrics(fin, true);
    expect(m).toEqual({ fwdPE: 10, pb: 1.2, pffoOrPe: 9, peg: null });
    expect(m).not.toHaveProperty("evEbitda");
  });
  it("REIT uses P/FFO when present", () => {
    expect(buildMetrics({ symbol: "R", price: 50, pe: 40, pffo: 14, isReit: true, pb: 1.5 }, true).pffoOrPe).toBe(14);
  });
  it("thin sectors fall back to whole-pool peers", () => {
    const r = scoreValuation([...tech(10), mk("U1", "Utilities", { fwdPE: 5, evEbitda: 5, pFcf: 5 })], cfg.valuation);
    expect(r.find((x) => x.symbol === "U1")!.score!).toBeGreaterThan(90); // cheapest vs pool
  });
});

describe("ranking", () => {
  it("sector cap and topN, valuation-desc order", () => {
    const cands = Array.from({ length: 20 }, (_, i) => ({ symbol: `A${i}`, sector: i < 10 ? "Tech" : "Energy", valuationScore: 100 - i, momentumScore: 50 }));
    const top = selectTop(cands, { ...cfg.ranking, topN: 8, maxPerSector: 3 });
    expect(top).toHaveLength(6); // only 3 Tech + 3 Energy fit under the cap... but Energy has 10 candidates
    expect(top.filter((t) => t.sector === "Tech")).toHaveLength(3);
    expect(top.map((t) => t.valuationScore)).toEqual([...top.map((t) => t.valuationScore)].sort((a, b) => b - a));
  });
  it("quality guards", () => {
    const base: Fundamentals = { symbol: "X", netIncomeTTM: 1, fcfTTM: 1, equity: 1, debtToEbitda: 2, altmanZ: 3, fwdEps: 2 };
    expect(qualityRedFlag(base, "Technology", cfg)).toBeNull();
    expect(qualityRedFlag({ ...base, debtToEbitda: 6 }, "Technology", cfg)).toMatch(/debt\/EBITDA/);
    expect(qualityRedFlag({ ...base, debtToEbitda: 6 }, "Financial Services", cfg)).toBeNull(); // leverage guard skips financials
    expect(qualityRedFlag({ ...base, netIncomeTTM: -1, fwdEps: -1 }, "Technology", cfg)).toMatch(/earnings/);
    expect(qualityRedFlag({ ...base, altmanZ: 0.5, fcfTTM: -1 }, "Technology", cfg)).toMatch(/going-concern/);
    expect(qualityRedFlag(undefined, "Technology", cfg)).toMatch(/no fundamentals/);
  });
});

describe("report text + backtest stats", () => {
  it("why line mentions cheapest metric", () => {
    const w = whyLine({ momentumScore: 91.2, valuationScore: 84, ret6m: 0.31, pctFromHigh: 2.4, metricPercentiles: { fwdPE: 70, evEbitda: 92 }, metricValues: { evEbitda: 9.1 } });
    expect(w).toContain("EV/EBITDA 9.1x");
    expect(w).toContain("+31%");
  });
  it("perfStats: CAGR, drawdown, hit rate", () => {
    const s = perfStats([0.1, -0.2, 0.1, 0.1], [0.05, 0.05, 0.05, 0.2]);
    expect(s.maxDrawdown).toBeCloseTo(-0.2, 10);
    expect(s.hitRate).toBe(0.5);
    expect(s.cagr).toBeCloseTo((1.1 * 0.8 * 1.1 * 1.1) ** 3 - 1, 8);
  });
});
