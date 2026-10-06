import type { Bar } from "./types";

export const closes = (bars: Bar[]) => bars.map((b) => b.close);

export function sma(values: number[], period: number): number | null {
  if (values.length < period) return null;
  let s = 0;
  for (let i = values.length - period; i < values.length; i++) s += values[i];
  return s / period;
}

/** Wilder RSI over the full series. */
export function rsi(values: number[], period = 14): number | null {
  if (values.length < period + 1) return null;
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = values[i] - values[i - 1];
    if (d >= 0) gain += d; else loss -= d;
  }
  let avgG = gain / period, avgL = loss / period;
  for (let i = period + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    avgG = (avgG * (period - 1) + Math.max(d, 0)) / period;
    avgL = (avgL * (period - 1) + Math.max(-d, 0)) / period;
  }
  if (avgL === 0) return 100;
  return 100 - 100 / (1 + avgG / avgL);
}

/** Return from `lagStart` bars ago to `lagEnd` bars ago (0 = latest bar). */
export function periodReturn(values: number[], lagStart: number, lagEnd = 0): number | null {
  const iEnd = values.length - 1 - lagEnd, iStart = values.length - 1 - lagStart;
  if (iStart < 0 || iEnd < 0 || values[iStart] <= 0) return null;
  return values[iEnd] / values[iStart] - 1;
}

export const TRADING_DAYS = { m1: 21, m3: 63, m6: 126, y1: 252 };
