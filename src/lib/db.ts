import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { defaultConfig, type ScreenerConfig } from "@config/screener.config";
import { applyEnvOverrides, mergeConfig } from "./config";
import type { ReportData } from "./types";
import type { ScoreRow, UniverseRow } from "./pipeline";

let client: SupabaseClient | null = null;
export function db(): SupabaseClient {
  if (!client) {
    const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set");
    client = createClient(url, key, { auth: { persistSession: false } });
  }
  return client;
}

const check = <T extends { error: { message: string } | null }>(r: T, what: string): T => {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r;
};

export async function loadConfig(): Promise<ScreenerConfig> {
  let over: Record<string, unknown> | null = null;
  try {
    const { data } = await db().from("app_config").select("config").eq("id", 1).maybeSingle();
    over = (data?.config as Record<string, unknown>) ?? null;
  } catch { /* DB not configured (e.g. local dry run): defaults only */ }
  return applyEnvOverrides(mergeConfig(defaultConfig, over));
}

export async function saveConfig(config: ScreenerConfig) {
  check(await db().from("app_config").upsert({ id: 1, config, updated_at: new Date().toISOString() }), "save config");
}

export type RunState = "none" | "success" | "running" | "failed";

/** Idempotency gate: returns "claimed" if this invocation may run, else the reason it must not. */
export async function claimRun(runDate: string): Promise<"claimed" | "already_success" | "in_progress"> {
  const { data } = check(await db().from("runs").select("*").eq("run_date", runDate).maybeSingle(), "read run");
  if (data?.status === "success") return "already_success";
  if (data?.status === "running" && Date.now() - new Date(data.started_at).getTime() < 15 * 60_000) return "in_progress";
  check(await db().from("runs").upsert({ run_date: runDate, status: "running", started_at: new Date().toISOString(), finished_at: null, error: null, attempts: (data?.attempts ?? 0) }), "claim run");
  return "claimed";
}

export async function finishRun(runDate: string, status: "success" | "failed", attempts: number, error?: string, meta?: unknown) {
  check(await db().from("runs").update({ status, attempts, error: error ?? null, finished_at: new Date().toISOString(), meta: meta ?? null }).eq("run_date", runDate), "finish run");
}

export async function logError(runDate: string | null, stage: string, err: unknown, detail?: unknown) {
  try {
    await db().from("errors").insert({ run_date: runDate, stage, message: err instanceof Error ? err.message : String(err), detail: detail ?? null });
  } catch { /* never mask the original failure */ }
}

export async function previousTickers(runDate: string): Promise<string[]> {
  const { data } = await db().from("reports").select("top_tickers").lt("run_date", runDate).order("run_date", { ascending: false }).limit(1).maybeSingle();
  return (data?.top_tickers as string[]) ?? [];
}

async function upsertChunks(table: string, rows: Record<string, unknown>[], conflict: string) {
  for (let i = 0; i < rows.length; i += 500) {
    check(await db().from(table).upsert(rows.slice(i, i + 500), { onConflict: conflict }), `upsert ${table}`);
  }
}

export async function persistScores(runDate: string, universe: UniverseRow[], scores: ScoreRow[]) {
  await upsertChunks("universe_snapshots", universe.map((u) => ({ run_date: runDate, ...u })), "run_date,symbol");
  await upsertChunks("scores", scores.map((s) => ({ run_date: runDate, ...s })), "run_date,symbol");
}

export async function persistReport(rep: ReportData, html: string, csv: string, recipient: string, resendId: string | null) {
  check(await db().from("reports").upsert({
    run_date: rep.runDate, html, csv, rows: rep.rows, regime: rep.regime, warnings: rep.warnings,
    top_tickers: rep.rows.map((r) => r.symbol), recipient, resend_id: resendId, sent_at: resendId ? new Date().toISOString() : null,
  }, { onConflict: "run_date" }), "persist report");
}
