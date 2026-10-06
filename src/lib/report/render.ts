import type { ReportData, ReportRow } from "../types";
import type { ScreenerConfig } from "@config/screener.config";

const e = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const n = (v: number | null, d = 1, suf = "") => (v == null ? "–" : v.toFixed(d) + suf);
const sgn = (v: number | null, d = 1) => (v == null ? "–" : `${v > 0 ? "+" : ""}${v.toFixed(d)}%`);
const color = (v: number | null) => (v == null ? "#6b7280" : v >= 0 ? "#047857" : "#b91c1c");

const TD = "padding:7px 8px;border-bottom:1px solid #e5e7eb;font-size:13px;white-space:nowrap;text-align:right;";
const TH = "padding:8px;background:#111827;color:#fff;font-size:11px;text-transform:uppercase;letter-spacing:.04em;text-align:right;white-space:nowrap;";

function chip(f: string) {
  const bg = f.startsWith("Earnings") ? "#fef3c7;color:#92400e" : f.startsWith("Gap") ? "#dbeafe;color:#1e40af" : "#fee2e2;color:#991b1b";
  return `<span style="display:inline-block;margin:2px 4px 0 0;padding:1px 7px;border-radius:9px;font-size:11px;background:${bg}">${e(f)}</span>`;
}

function rowHtml(r: ReportRow, i: number): string {
  const bg = i % 2 ? "#f9fafb" : "#ffffff";
  return `<tr style="background:${bg}">
<td style="${TD}text-align:center;font-weight:700">${r.rank}</td>
<td style="${TD}text-align:left;white-space:normal;min-width:150px"><b style="font-size:14px">${e(r.symbol)}</b><br><span style="color:#374151;font-size:12px">${e(r.name)}</span><br><span style="color:#6b7280;font-size:11px">${e(r.sector)}</span></td>
<td style="${TD}">$${r.price.toFixed(2)}</td>
<td style="${TD}color:${color(r.preMarketPct)}">${sgn(r.preMarketPct, 2)}</td>
<td style="${TD}font-weight:600">${n(r.momentumScore, 0)}</td>
<td style="${TD}font-weight:600">${n(r.valuationScore, 0)}</td>
<td style="${TD}">${n(r.fwdPE, 1, "x")}</td><td style="${TD}">${n(r.evEbitda, 1, "x")}</td><td style="${TD}">${n(r.pFcf, 1, "x")}</td>
<td style="${TD}color:${color(r.ret6m)}">${sgn(r.ret6m * 100, 0)}</td>
<td style="${TD}">${n(-r.pctFromHigh, 1, "%")}</td>
<td style="${TD}">${n(r.rsi, 0)}</td>
<td style="${TD}">${e(r.nextEarnings ?? "–")}</td></tr>
<tr style="background:${bg}"><td></td><td colspan="12" style="padding:2px 8px 9px;border-bottom:1px solid #e5e7eb;font-size:12px;color:#374151;white-space:normal"><div style="max-width:92vw;position:sticky;left:0">${e(r.why)}${r.flags.length ? "<br>" + r.flags.map(chip).join("") : ""}</div></td></tr>`;
}

export function renderHtml(rep: ReportData, cfg: ScreenerConfig): string {
  const g = rep.regime;
  const stat = (label: string, value: string, c = "#111827") =>
    `<td style="padding:10px 14px;border:1px solid #e5e7eb;background:#fff"><div style="font-size:11px;color:#6b7280;text-transform:uppercase">${label}</div><div style="font-size:17px;font-weight:700;color:${c}">${value}</div></td>`;
  const list = (xs: string[]) => (xs.length ? xs.map(e).join(", ") : "none");
  const w = cfg.momentum.weights, v = cfg.valuation.weights;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pre-Market Momentum-Value Screener ${e(rep.runDate)}</title></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111827">
<div style="max-width:980px;margin:0 auto;padding:16px">
${rep.isMock ? `<div style="background:#fef3c7;border:1px solid #f59e0b;padding:8px 12px;margin-bottom:12px;font-size:13px"><b>MOCK DATA</b> – synthetic tickers and prices for demonstration only.</div>` : ""}
<h1 style="margin:0 0 2px;font-size:22px">Pre-Market Momentum-Value Screener</h1>
<div style="color:#6b7280;font-size:13px;margin-bottom:14px">${e(rep.runDate)} · top ${rep.rows.length} high-momentum US stocks, most undervalued first</div>
<table role="presentation" cellspacing="6" style="border-collapse:separate;margin:0 -6px 12px"><tr>
${stat("SPY vs 200DMA", `${g.spyAbove200 ? "Above" : "Below"} (${sgn(((g.spyClose / g.spy200dma) - 1) * 100, 1)})`, g.spyAbove200 ? "#047857" : "#b91c1c")}
${stat("VIX", n(g.vix, 1))}${stat("S&P futures", sgn(g.futuresPct, 2), color(g.futuresPct))}</tr></table>
<div style="overflow-x:auto;-webkit-overflow-scrolling:touch;border:1px solid #e5e7eb;background:#fff">
<table style="border-collapse:collapse;width:100%;min-width:820px"><thead><tr>
${["#", "Stock", "Price", "Pre-mkt", "Mom", "Val", "Fwd P/E", "EV/EBITDA", "P/FCF", "6m", "vs 52wH", "RSI", "Earnings"].map((h, i) => `<th style="${TH}${i === 1 ? "text-align:left" : ""}">${h}</th>`).join("")}
</tr></thead><tbody>${rep.rows.map(rowHtml).join("")}</tbody></table></div>
<h3 style="margin:20px 0 6px;font-size:15px">Changes vs previous report</h3>
<div style="font-size:13px;line-height:1.6"><b style="color:#047857">New entrants:</b> ${list(rep.newEntrants)}<br><b style="color:#b91c1c">Dropped out:</b> ${list(rep.droppedOut)}</div>
${rep.warnings.length ? `<h3 style="margin:20px 0 6px;font-size:15px">Data-quality warnings (${rep.warnings.length})</h3><ul style="font-size:12px;color:#92400e;margin:0;padding-left:18px">${rep.warnings.slice(0, 10).map((x) => `<li>${e(x)}</li>`).join("")}${rep.warnings.length > 10 ? `<li>…and ${rep.warnings.length - 10} more (see CSV/admin)</li>` : ""}</ul>` : ""}
<h3 style="margin:20px 0 6px;font-size:15px">Methodology</h3>
<p style="font-size:12px;color:#4b5563;line-height:1.5;margin:0">
<b>1. Momentum</b> (percentile 0–100 across the filtered universe, price ≥ $${cfg.universe.minPrice}, mkt cap ≥ $${cfg.universe.minMarketCap / 1e9}B, 30d ADV ≥ $${cfg.universe.minAvgDollarVolume30d / 1e6}M): 12-1m ${w.ret12_1 * 100}%, 6m ${w.ret6m * 100}%, 3m ${w.ret3m * 100}%, 6m RS vs SPY ${w.rsVsSpy6m * 100}%, 52w-high proximity ${w.high52Proximity * 100}%; must trade above 50- and 200-day MA; top ${cfg.momentum.poolSize} form the pool.
<b>2. Valuation</b> (0–100, higher = cheaper vs sector peers in the pool): Fwd P/E ${v.fwdPE * 100}%, EV/EBITDA ${v.evEbitda * 100}%, P/FCF ${v.pFcf * 100}%, EV/Sales ${v.evSales * 100}%, PEG ${v.peg * 100}%; invalid/negative metrics dropped and weights re-normalised (min ${cfg.valuation.minValidMetrics} valid); financials/REITs use P/B and P/FFO-or-P/E.
<b>3. Ranking:</b> pool sorted by valuation, quality guards (earnings/going-concern flags, debt/EBITDA &gt; ${cfg.ranking.maxDebtToEbitda}), max ${cfg.ranking.maxPerSector} per sector. RSI &gt; ${cfg.momentum.rsiOverextended} is flagged, not excluded.</p>
<p style="font-size:11px;color:#6b7280;margin:14px 0 0">Data as of ${e(rep.dataTimestamp)} (prior close; pre-market where available). Generated ${e(rep.generatedAt)}.<br>
<b>Not investment advice.</b> For information only; no recommendation to buy or sell any security. Past performance does not guarantee future results. Data may be delayed, incomplete or inaccurate.</p>
</div></body></html>`;
}
