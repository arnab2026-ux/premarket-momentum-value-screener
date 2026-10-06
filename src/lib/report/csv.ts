import type { ReportData } from "../types";

const esc = (v: unknown) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv(rep: ReportData): string {
  const head = ["rank", "ticker", "company", "sector", "price", "premarket_pct", "momentum_score", "valuation_score",
    "fwd_pe", "ev_ebitda", "p_fcf", "ret_6m_pct", "pct_from_52w_high", "rsi14", "next_earnings", "flags", "why"];
  const f = (n: number | null, d = 2) => (n == null ? "" : n.toFixed(d));
  const lines = rep.rows.map((r) => [
    r.rank, r.symbol, r.name, r.sector, f(r.price), f(r.preMarketPct), f(r.momentumScore, 1), f(r.valuationScore, 1),
    f(r.fwdPE, 1), f(r.evEbitda, 1), f(r.pFcf, 1), f(r.ret6m * 100, 1), f(r.pctFromHigh, 1), f(r.rsi, 1),
    r.nextEarnings ?? "", r.flags.join(" | "), r.why,
  ].map(esc).join(","));
  return [head.join(","), ...lines].join("\n");
}
