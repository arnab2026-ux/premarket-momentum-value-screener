import type {
  Bar, Fundamentals, HistoricalFundamentals, MarketDataProvider, MarketRegime, Quote, UniverseMember,
} from "../types";
import type { ScreenerConfig } from "@config/screener.config";
import { addDays, nyClock } from "../calendar";
import { chunk, fetchJson, pMap } from "./http";

const BASE = "https://financialmodelingprep.com/stable";
type Obj = Record<string, unknown>;

/** First finite number among candidate field names (FMP renames fields between API versions). */
const num = (o: Obj | undefined, ...names: string[]): number | null => {
  if (!o) return null;
  for (const n of names) {
    const v = o[n];
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return null;
};

const EXCLUDED_NAME = /\b(ADR|ADS|acquisition corp|blank check|warrants?|units?)\b/i;

/**
 * Financial Modeling Prep adapter (stable API). Field names are isolated here; if FMP changes a
 * payload, fix it in this file only. Run `npm run dry-run -- --provider=fmp --limit=20` to smoke-test.
 */
export class FmpProvider implements MarketDataProvider {
  name = "fmp";
  warnings: string[] = [];
  private concurrency = 8;

  constructor(private apiKey: string, private cfg: ScreenerConfig["universe"], private runDate: string) {
    if (!apiKey) throw new Error("FMP_API_KEY is not set");
  }

  private get<T>(path: string, params: Record<string, string | number | boolean> = {}): Promise<T> {
    const qs = new URLSearchParams({ ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])), apikey: this.apiKey });
    return fetchJson<T>(`${BASE}/${path}?${qs}`, { onRetry: (m) => this.warn(`${path}: ${m}`) });
  }
  private warn(m: string) { if (this.warnings.length < 200) this.warnings.push(m); }

  /** universe.source = "csv": tickers from config/universe-override.csv (one per line, optional header), profiles from FMP. */
  private async universeFromCsv(): Promise<UniverseMember[]> {
    const { readFile } = await import("node:fs/promises");
    const path = await import("node:path");
    const text = await readFile(path.join(process.cwd(), "config", "universe-override.csv"), "utf8");
    const symbols = [...new Set(text.split(/\r?\n/).map((l) => l.split(",")[0].trim().toUpperCase()).filter((s) => /^[A-Z.\-]{1,6}$/.test(s) && s !== "SYMBOL" && s !== "TICKER"))];
    const res = await pMap(symbols, this.concurrency, async (s) => (await this.get<Obj[]>("profile", { symbol: s }))[0],
      (s, e) => this.warn(`profile failed for ${s}: ${(e as Error).message}`));
    return res.flatMap(({ value: r }) => (r && r.sector && !r.isEtf && !r.isFund && !EXCLUDED_NAME.test(String(r.companyName ?? ""))
      ? [{
        symbol: String(r.symbol), name: String(r.companyName ?? r.symbol), sector: String(r.sector), industry: r.industry ? String(r.industry) : undefined,
        exchange: String(r.exchange ?? r.exchangeShortName ?? "").toUpperCase(), price: num(r, "price") ?? 0, marketCap: num(r, "marketCap", "mktCap") ?? 0,
      }] : []));
  }

  async getUniverse(): Promise<UniverseMember[]> {
    if (this.cfg.source === "csv") return this.universeFromCsv();
    const rows = await this.get<Obj[]>("company-screener", {
      marketCapMoreThan: this.cfg.minMarketCap, priceMoreThan: this.cfg.minPrice,
      isEtf: false, isFund: false, isActivelyTrading: true, country: "US",
      exchange: this.cfg.exchanges.join(","), limit: 5000,
    });
    return rows
      .filter((r) => !EXCLUDED_NAME.test(String(r.companyName ?? "")) && !/shell/i.test(String(r.industry ?? "")))
      .filter((r) => r.sector && r.symbol)
      .sort((a, b) => (num(b, "marketCap") ?? 0) - (num(a, "marketCap") ?? 0))
      .slice(0, this.cfg.size)
      .map((r) => ({
        symbol: String(r.symbol), name: String(r.companyName ?? r.symbol), sector: String(r.sector),
        industry: r.industry ? String(r.industry) : undefined,
        exchange: String(r.exchangeShortName ?? r.exchange ?? ""), price: num(r, "price") ?? 0,
        marketCap: num(r, "marketCap") ?? 0, avgVolume30d: num(r, "volume") ?? undefined,
      }));
  }

  async getDailyBars(symbols: string[], from: string, to: string): Promise<Record<string, Bar[]>> {
    const res = await pMap(symbols, this.concurrency, async (s) => {
      const rows = await this.get<Obj[]>("historical-price-eod/full", { symbol: s, from, to });
      return rows
        .map((r) => ({ date: String(r.date), open: num(r, "open") ?? 0, high: num(r, "high") ?? 0, low: num(r, "low") ?? 0, close: num(r, "close") ?? 0, volume: num(r, "volume") ?? 0 }))
        .filter((b) => b.close > 0)
        .sort((a, b) => a.date.localeCompare(b.date));
    }, (s, e) => this.warn(`bars failed for ${s}: ${(e as Error).message}`));
    return Object.fromEntries(res.map((r) => [r.item, r.value]));
  }

  async getQuotes(symbols: string[]): Promise<Record<string, Quote>> {
    const out: Record<string, Quote> = {};
    const today = nyClock().date;
    for (const part of chunk(symbols, 100)) {
      try {
        const rows = await this.get<Obj[]>("batch-quote", { symbols: part.join(",") });
        for (const r of rows) {
          const price = num(r, "price"), prev = num(r, "previousClose");
          const ts = num(r, "timestamp") ?? 0;
          if (price == null || prev == null) continue;
          const quoteDate = nyClock(new Date(ts * 1000)).date;
          // only trust the quote as a pre-market print if it was stamped today
          out[String(r.symbol)] = { symbol: String(r.symbol), price, previousClose: prev, preMarketPrice: quoteDate === today ? price : null, timestamp: ts };
        }
      } catch (e) { this.warn(`batch-quote failed: ${(e as Error).message}`); }
    }
    return out;
  }

  async getFundamentals(symbols: string[]): Promise<Record<string, Fundamentals>> {
    const today = nyClock().date;
    const res = await pMap(symbols, this.concurrency, async (s): Promise<Fundamentals> => {
      const [km, rt, fs, est] = await Promise.all([
        this.get<Obj[]>("key-metrics-ttm", { symbol: s }).catch(() => []),
        this.get<Obj[]>("ratios-ttm", { symbol: s }).catch(() => []),
        this.get<Obj[]>("financial-scores", { symbol: s }).catch(() => []),
        this.get<Obj[]>("analyst-estimates", { symbol: s, period: "annual", limit: 6 }).catch(() => []),
      ]);
      const k = km[0], r = rt[0];
      // nearest fiscal year ending after today = the next unreported year
      const next = est.filter((e) => String(e.date) > today).sort((a, b) => String(a.date).localeCompare(String(b.date)))[0];
      const pFcf = num(r, "priceToFreeCashFlowRatioTTM");
      return {
        symbol: s,
        fwdEps: num(next, "epsAvg"),
        evEbitda: num(k, "evToEBITDATTM", "enterpriseValueOverEBITDATTM"),
        evSales: num(k, "evToSalesTTM"),
        pFcf,
        pe: num(r, "priceToEarningsRatioTTM", "peRatioTTM"),
        pb: num(r, "priceToBookRatioTTM"),
        peg: num(r, "priceToEarningsGrowthRatioTTM", "priceEarningsToGrowthRatioTTM"),
        pffo: pFcf, // FMP has no P/FFO; P/FCF is the closest proxy for REITs
        netIncomeTTM: num(r, "netIncomePerShareTTM"),
        fcfTTM: num(r, "freeCashFlowPerShareTTM"),
        equity: num(r, "bookValuePerShareTTM"),
        debtToEbitda: num(k, "netDebtToEBITDATTM"),
        altmanZ: num(fs[0], "altmanZScore"),
      };
    }, (s, e) => this.warn(`fundamentals failed for ${s}: ${(e as Error).message}`));
    return Object.fromEntries(res.map((r) => [r.item, r.value]));
  }

  async getEarningsDates(symbols: string[], from: string, to: string): Promise<Record<string, string>> {
    const want = new Set(symbols);
    const out: Record<string, string> = {};
    try {
      const rows = await this.get<Obj[]>("earnings-calendar", { from, to });
      for (const r of rows.sort((a, b) => String(a.date).localeCompare(String(b.date)))) {
        const s = String(r.symbol);
        if (want.has(s) && !out[s]) out[s] = String(r.date);
      }
    } catch (e) { this.warn(`earnings-calendar failed: ${(e as Error).message}`); }
    return out;
  }

  async getMarketRegime(): Promise<MarketRegime> {
    const to = this.runDate, from = addDays(to, -400);
    const spy = (await this.getDailyBars(["SPY"], from, to)).SPY ?? [];
    const last = spy.at(-1)?.close ?? 0;
    const sma200 = spy.length >= 200 ? spy.slice(-200).reduce((s, b) => s + b.close, 0) / 200 : 0;
    const q = async (sym: string) => (await this.get<Obj[]>("quote", { symbol: sym }).catch(() => []))[0];
    const vix = num(await q("^VIX"), "price");
    const fut = await q(process.env.FUTURES_SYMBOL ?? "ES=F");
    const futuresPct = num(fut, "changePercentage", "changesPercentage");
    if (vix == null) this.warn("VIX unavailable");
    if (futuresPct == null) this.warn("S&P futures unavailable (set FUTURES_SYMBOL)");
    return { spyClose: last, spy200dma: sma200, spyAbove200: last > sma200, vix, futuresPct };
  }

  /** Quarterly ratios stamped with a conservative filing date (period end + 60 days) for point-in-time use. */
  async getHistoricalFundamentals(symbols: string[]): Promise<Record<string, HistoricalFundamentals[]>> {
    const res = await pMap(symbols, this.concurrency, async (s) => {
      const rows = await this.get<Obj[]>("ratios", { symbol: s, period: "quarter", limit: 24 });
      return rows.map((r): HistoricalFundamentals => ({
        date: addDays(String(r.date), 60),
        pe: num(r, "priceToEarningsRatio"), pb: num(r, "priceToBookRatio"), pFcf: num(r, "priceToFreeCashFlowRatio"),
        evSales: num(r, "priceToSalesRatio"), // P/S proxy
        evEbitda: num(r, "enterpriseValueMultiple"), peg: num(r, "priceToEarningsGrowthRatio"),
        netIncome: num(r, "netIncomePerShare"),
      })).sort((a, b) => a.date.localeCompare(b.date));
    }, (s, e) => this.warn(`historical ratios failed for ${s}: ${(e as Error).message}`));
    return Object.fromEntries(res.map((r) => [r.item, r.value]));
  }
}
