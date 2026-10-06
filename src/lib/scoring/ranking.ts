import type { Fundamentals } from "../types";
import type { ScreenerConfig } from "@config/screener.config";
import { isFinancialSector } from "./valuation";

export interface Candidate { symbol: string; sector: string; valuationScore: number; momentumScore: number }

/** Reason string if the stock fails a quality guard, else null. */
export function qualityRedFlag(f: Fundamentals | undefined, sector: string, cfg: ScreenerConfig): string | null {
  if (!f) return "no fundamentals";
  const financial = isFinancialSector(sector, cfg.valuation);
  if (f.netIncomeTTM != null && f.netIncomeTTM < 0 && !(f.fwdEps && f.fwdEps > 0))
    return "earnings red flag (loss-making, no positive forward EPS)";
  const burning = (f.fcfTTM ?? 0) < 0;
  if ((f.altmanZ != null && f.altmanZ < 1.0 && burning) || (f.equity != null && f.equity < 0 && burning))
    return "going-concern red flag (distress score / negative equity with negative FCF)";
  if (!financial && f.debtToEbitda != null && f.debtToEbitda > cfg.ranking.maxDebtToEbitda)
    return `debt/EBITDA ${f.debtToEbitda.toFixed(1)} > ${cfg.ranking.maxDebtToEbitda}`;
  return null;
}

/** Sort by valuation desc (tie-break momentum), enforce the sector cap, take topN. */
export function selectTop(cands: Candidate[], cfg: ScreenerConfig["ranking"]): Candidate[] {
  const sorted = [...cands].sort((a, b) => b.valuationScore - a.valuationScore || b.momentumScore - a.momentumScore);
  const perSector = new Map<string, number>();
  const out: Candidate[] = [];
  for (const c of sorted) {
    if (out.length >= cfg.topN) break;
    const n = perSector.get(c.sector) ?? 0;
    if (n >= cfg.maxPerSector) continue;
    perSector.set(c.sector, n + 1);
    out.push(c);
  }
  return out;
}
