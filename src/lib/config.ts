import { defaultConfig, type ScreenerConfig } from "@config/screener.config";

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

/** Deep-merge overrides over defaults (arrays are replaced, not merged). */
export function mergeConfig<T extends Json>(base: T, over: Json | null | undefined): T {
  if (!over) return base;
  const out: Json = { ...base };
  for (const [k, v] of Object.entries(over)) {
    out[k] = isObj(v) && isObj(out[k]) ? mergeConfig(out[k] as Json, v) : v;
  }
  return out as T;
}

/** Structural validation against the defaults: same keys, same primitive types, numbers finite. Returns error list. */
export function validateConfig(candidate: unknown, ref: unknown = defaultConfig, path = "config"): string[] {
  if (isObj(ref)) {
    if (!isObj(candidate)) return [`${path}: expected object`];
    const errs: string[] = [];
    for (const k of Object.keys(ref)) {
      if (!(k in candidate)) errs.push(`${path}.${k}: missing`);
      else errs.push(...validateConfig(candidate[k], ref[k], `${path}.${k}`));
    }
    for (const k of Object.keys(candidate)) if (!(k in ref)) errs.push(`${path}.${k}: unknown key`);
    return errs;
  }
  if (Array.isArray(ref)) {
    if (!Array.isArray(candidate)) return [`${path}: expected array`];
    if (ref.length && candidate.some((x) => typeof x !== typeof ref[0])) return [`${path}: wrong element type`];
    return [];
  }
  if (typeof candidate !== typeof ref) return [`${path}: expected ${typeof ref}`];
  if (typeof candidate === "number" && !Number.isFinite(candidate)) return [`${path}: not finite`];
  return [];
}

/** Extra semantic checks: weights positive, recipient looks like an email. */
export function semanticErrors(c: ScreenerConfig): string[] {
  const errs: string[] = [];
  const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);
  for (const [name, w] of [["momentum.weights", c.momentum.weights], ["valuation.weights", c.valuation.weights], ["valuation.financialWeights", c.valuation.financialWeights]] as const) {
    if (Object.values(w).some((x) => x < 0) || sum(w) <= 0) errs.push(`${name}: weights must be >= 0 with a positive sum`);
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c.recipientEmail)) errs.push("recipientEmail: invalid");
  if (c.ranking.topN < 1 || c.ranking.maxPerSector < 1) errs.push("ranking: topN and maxPerSector must be >= 1");
  return errs;
}

export function applyEnvOverrides(c: ScreenerConfig): ScreenerConfig {
  return process.env.REPORT_RECIPIENT ? { ...c, recipientEmail: process.env.REPORT_RECIPIENT } : c;
}
