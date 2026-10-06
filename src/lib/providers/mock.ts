import type {
  Bar, Fundamentals, HistoricalFundamentals, MarketDataProvider, MarketRegime, Quote, UniverseMember,
} from "../types";
import { addDays, isTradingDay, previousTradingDay } from "../calendar";

const SECTORS = [
  "Technology", "Healthcare", "Financial Services", "Consumer Cyclical", "Industrials", "Energy",
  "Utilities", "Real Estate", "Basic Materials", "Communication Services", "Consumer Defensive",
];

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hash = (s: string) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7);
const gauss = (r: () => number) => Math.sqrt(-2 * Math.log(r() || 1e-9)) * Math.cos(2 * Math.PI * r());

const tickerFor = (i: number) => {
  const L = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  return L[i % 26] + L[Math.floor(i / 26) % 26] + L[(Math.floor(i / 676) + 7) % 26] + "X".repeat(0);
};

/** Deterministic synthetic market: random-walk prices, plausible multiples. For tests, demos, dry runs. */
export class MockProvider implements MarketDataProvider {
  name = "mock";
  warnings: string[] = [];
  private cache = new Map<string, Bar[]>();

  constructor(private asOf: string, private size = 420, private nBars = 1300) {}

  private symbols() { return Array.from({ length: this.size }, (_, i) => tickerFor(i)).concat("SPY"); }
  private sectorOf(s: string) { return SECTORS[hash(s) % SECTORS.length]; }

  private bars(sym: string): Bar[] {
    const hit = this.cache.get(sym);
    if (hit) return hit;
    const r = mulberry32(hash(sym));
    const drift = sym === "SPY" ? 0.1 : -0.15 + r() * 0.75, vol = sym === "SPY" ? 0.16 : 0.2 + r() * 0.3;
    // trading days ending the day before asOf
    const dates: string[] = [];
    let d = previousTradingDay(this.asOf);
    while (dates.length < this.nBars) { if (isTradingDay(d)) dates.push(d); d = addDays(d, -1); }
    dates.reverse();
    let px = 20 + r() * 180;
    const base = 1_000_000 + r() * 8_000_000;
    const bars: Bar[] = dates.map((date) => {
      const ret = drift / 252 + (vol / Math.sqrt(252)) * gauss(r);
      const open = px; px = Math.max(1, px * (1 + ret));
      const hi = Math.max(open, px) * (1 + r() * 0.01), lo = Math.min(open, px) * (1 - r() * 0.01);
      return { date, open, high: hi, low: lo, close: px, volume: Math.round(base * (0.7 + r() * 0.6)) };
    });
    this.cache.set(sym, bars);
    return bars;
  }

  async getUniverse(): Promise<UniverseMember[]> {
    return this.symbols().filter((s) => s !== "SPY").map((s, i) => {
      const b = this.bars(s), r = mulberry32(hash(s) + 1);
      return {
        symbol: s, name: `Mock ${s} Holdings`, sector: this.sectorOf(s), exchange: i % 2 ? "NYSE" : "NASDAQ",
        price: b.at(-1)!.close, marketCap: 2.5e9 + r() * 150e9,
      };
    });
  }

  async getDailyBars(symbols: string[], from: string, to: string) {
    return Object.fromEntries(symbols.map((s) => [s, this.bars(s).filter((b) => b.date >= from && b.date <= to)]));
  }

  async getQuotes(symbols: string[]): Promise<Record<string, Quote>> {
    return Object.fromEntries(symbols.map((s) => {
      const r = mulberry32(hash(s) + 99), prev = this.bars(s).at(-1)!.close;
      return [s, { symbol: s, price: prev, previousClose: prev, preMarketPrice: prev * (1 + (r() - 0.5) * 0.08), timestamp: Date.now() / 1000 }];
    }));
  }

  async getFundamentals(symbols: string[]): Promise<Record<string, Fundamentals>> {
    return Object.fromEntries(symbols.map((s) => {
      const r = mulberry32(hash(s) + 7), px = this.bars(s).at(-1)!.close;
      const loss = r() < 0.08;
      const f: Fundamentals = {
        symbol: s, fwdEps: loss ? -1 : px / (8 + r() * 40),
        evEbitda: r() < 0.06 ? -5 : 5 + r() * 25, pFcf: r() < 0.1 ? null : 8 + r() * 45, evSales: 0.8 + r() * 12,
        peg: r() < 0.25 ? null : 0.4 + r() * 3, pb: 0.8 + r() * 6, pe: 8 + r() * 40, pffo: 10 + r() * 14,
        netIncomeTTM: loss ? -1 : 1, fcfTTM: 1, equity: 1, altmanZ: 1 + r() * 5, debtToEbitda: r() * 5.5,
      };
      return [s, f];
    }));
  }

  async getEarningsDates(symbols: string[], from: string) {
    return Object.fromEntries(symbols.map((s) => [s, addDays(from, hash(s) % 60)]));
  }

  async getMarketRegime(): Promise<MarketRegime> {
    const spy = this.bars("SPY"), last = spy.at(-1)!.close;
    const sma200 = spy.slice(-200).reduce((s, b) => s + b.close, 0) / 200;
    return { spyClose: last, spy200dma: sma200, spyAbove200: last > sma200, vix: 16.8, futuresPct: 0.21 };
  }

  async getHistoricalFundamentals(symbols: string[]): Promise<Record<string, HistoricalFundamentals[]>> {
    const dates = this.bars("SPY").filter((_, i) => i % 63 === 0).map((b) => b.date);
    return Object.fromEntries(symbols.map((s) => {
      const r = mulberry32(hash(s) + 5);
      return [s, dates.map((date) => ({
        date, pe: 8 + r() * 40, evEbitda: 5 + r() * 25, pFcf: 8 + r() * 45, evSales: 0.8 + r() * 12, pb: 0.8 + r() * 6, peg: 0.4 + r() * 3, netIncome: 1,
      }))];
    }));
  }
}
