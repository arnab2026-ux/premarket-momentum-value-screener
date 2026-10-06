/**
 * 3-year backtest vs SPY with monthly rebalance.
 *   npm run backtest                                   (mock data: validates machinery, results are meaningless)
 *   npm run backtest -- --provider=fmp --end=2026-10-05
 */
import fs from "node:fs";
import path from "node:path";
import { defaultConfig } from "@config/screener.config";
import { runBacktest, type PerfStats } from "../src/lib/backtest";
import { previousTradingDay, nyClock } from "../src/lib/calendar";
import { createProvider } from "../src/lib/providers";

const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split("=")[1];
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

async function main() {
  const cfg = defaultConfig;
  const end = arg("end") ?? previousTradingDay(nyClock().date);
  const provider = createProvider(cfg, nyClock().date, arg("provider") ?? "mock");
  const res = await runBacktest(provider, cfg, { endDate: end, years: Number(arg("years") ?? cfg.backtest.years) });

  const row = (n: string, s: PerfStats) =>
    `${n.padEnd(34)}${pct(s.cagr).padStart(9)}${s.sharpe.toFixed(2).padStart(9)}${pct(s.maxDrawdown).padStart(11)}${pct(s.hitRate).padStart(11)}`;
  console.log(`\nBacktest through ${end} (${res.strategy.months} monthly periods, provider=${provider.name})\n`);
  console.log(`${"".padEnd(34)}${"CAGR".padStart(9)}${"Sharpe".padStart(9)}${"MaxDD".padStart(11)}${"HitRate*".padStart(11)}`);
  console.log(row("Momentum -> value top 30", res.strategy));
  console.log(row("Momentum-only top 30 (no value)", res.momentumOnly));
  console.log(row("SPY", res.spy));
  console.log(`\n* hit rate = % of months beating SPY. Avg monthly turnover: ${pct(res.strategy.avgTurnover ?? 0)}. Sharpe uses rf=0, monthly returns x sqrt(12).`);
  res.notes.forEach((n) => console.log(`- ${n}`));

  fs.mkdirSync("out", { recursive: true });
  const f = path.join("out", `backtest-${end}.json`);
  fs.writeFileSync(f, JSON.stringify(res, null, 2));
  console.log(`\nWrote ${f}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
