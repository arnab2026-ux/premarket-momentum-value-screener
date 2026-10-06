import { isTradingDay, nyClock, withinRunWindow } from "./calendar";
import { claimRun, finishRun, loadConfig, logError, persistReport, persistScores, previousTickers } from "./db";
import { sendFailureAlert, sendReportEmail } from "./email";
import { runPipeline } from "./pipeline";
import { createProvider } from "./providers";
import { toCsv } from "./report/csv";
import { renderHtml } from "./report/render";
import { sleep } from "./providers/http";

export type DailyOutcome =
  | { status: "skipped"; reason: string }
  | { status: "success"; runDate: string; resendId: string; rows: number }
  | { status: "failed"; runDate: string; error: string };

/** Entry point for the scheduled job. `force` bypasses the 08:30 window and trading-day check (manual runs). */
export async function runDaily(opts: { now?: Date; force?: boolean } = {}): Promise<DailyOutcome> {
  const now = opts.now ?? new Date();
  const cfg = await loadConfig();
  const clock = nyClock(now, cfg.timezone);
  const runDate = clock.date;

  if (!opts.force) {
    if (!isTradingDay(runDate)) return { status: "skipped", reason: `${runDate} is not an NYSE trading day` };
    if (!withinRunWindow(now, cfg.runTime, cfg.timezone))
      return { status: "skipped", reason: `NY time ${clock.hour}:${String(clock.minute).padStart(2, "0")} outside ${cfg.runTime.hour}:${String(cfg.runTime.minute).padStart(2, "0")} ± ${cfg.runTime.toleranceMinutes}m` };
  }

  const claim = await claimRun(runDate);
  if (claim !== "claimed" && !opts.force) return { status: "skipped", reason: claim };

  let lastErr = "unknown";
  for (let attempt = 1; attempt <= cfg.retry.attempts; attempt++) {
    try {
      const provider = createProvider(cfg, runDate);
      const prev = await previousTickers(runDate);
      const { report, universeRows, scoreRows } = await runPipeline({ provider, cfg, runDate, previousTickers: prev });
      if (report.rows.length === 0) throw new Error("pipeline produced 0 rows (data problem?)");
      const html = renderHtml(report, cfg), csv = toCsv(report);
      await persistScores(runDate, universeRows, scoreRows);
      const id = await sendReportEmail({
        to: cfg.recipientEmail, html, csv, runDate,
        subject: `Pre-Market Momentum-Value Top ${report.rows.length} — ${runDate}`,
      });
      await persistReport(report, html, csv, cfg.recipientEmail, id);
      await finishRun(runDate, "success", attempt, undefined, { warnings: report.warnings.length });
      return { status: "success", runDate, resendId: id, rows: report.rows.length };
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
      await logError(runDate, `attempt ${attempt}`, e);
      if (attempt < cfg.retry.attempts) await sleep(cfg.retry.backoffMs[attempt - 1] ?? cfg.retry.backoffMs.at(-1) ?? 5000);
    }
  }
  await finishRun(runDate, "failed", cfg.retry.attempts, lastErr);
  await sendFailureAlert(cfg.recipientEmail, runDate, lastErr);
  return { status: "failed", runDate, error: lastErr };
}
