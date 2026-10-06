/**
 * Dry run: full pipeline -> HTML + CSV on disk. Sends nothing, touches no database.
 *   npm run dry-run                                  (mock data)
 *   npm run dry-run -- --provider=fmp --limit=50     (live data, needs FMP_API_KEY)
 *   npm run dry-run -- --date=2026-10-06
 */
import fs from "node:fs";
import path from "node:path";
import { defaultConfig } from "@config/screener.config";
import { nyClock } from "../src/lib/calendar";
import { runPipeline } from "../src/lib/pipeline";
import { createProvider } from "../src/lib/providers";
import { toCsv } from "../src/lib/report/csv";
import { renderHtml } from "../src/lib/report/render";

const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split("=")[1];

async function main() {
  const cfg = defaultConfig;
  const runDate = arg("date") ?? nyClock().date;
  const providerName = arg("provider") ?? "mock";
  const provider = createProvider(cfg, runDate, providerName);
  const limit = arg("limit") ? Number(arg("limit")) : undefined;

  const t0 = Date.now();
  const { report, scoreRows } = await runPipeline({
    provider, cfg, runDate, limit,
    previousTickers: providerName === "mock" ? ["AAX", "BBX", "CBX"].concat(["ZZZ"]) : [], // demo "dropped/new" section
  });
  const outDir = path.resolve("out");
  fs.mkdirSync(outDir, { recursive: true });
  const htmlPath = path.join(outDir, `report-${runDate}.html`);
  fs.writeFileSync(htmlPath, renderHtml(report, cfg));
  fs.writeFileSync(path.join(outDir, `report-${runDate}.csv`), toCsv(report));
  console.log(`Provider=${provider.name} scored=${scoreRows.length} pool=${scoreRows.filter((s) => s.in_pool).length} rows=${report.rows.length} warnings=${report.warnings.length} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  console.log(`Wrote ${htmlPath}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
