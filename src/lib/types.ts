export interface Bar { date: string; open: number; high: number; low: number; close: number; volume: number }

export interface UniverseMember {
  symbol: string;
  name: string;
  sector: string;
  industry?: string;
  exchange: string;
  price: number;
  marketCap: number;
  avgVolume30d?: number; // shares
}

export interface Quote {
  symbol: string;
  price: number;
  previousClose: number;
  /** pre-market last price if available and fresh, else null */
  preMarketPrice: number | null;
  timestamp: number; // epoch seconds of the quote
}

export interface Fundamentals {
  symbol: string;
  fwdEps?: number | null;
  price?: number | null;
  evEbitda?: number | null;
  pFcf?: number | null;
  evSales?: number | null;
  peg?: number | null;
  pb?: number | null;
  pe?: number | null;
  pffo?: number | null;
  netIncomeTTM?: number | null;
  fcfTTM?: number | null;
  debtToEbitda?: number | null;
  altmanZ?: number | null;
  equity?: number | null;
  isReit?: boolean;
}

export interface HistoricalFundamentals {
  /** filing/acceptance date: only usable on or after this date (point-in-time) */
  date: string;
  pe?: number | null; evEbitda?: number | null; pFcf?: number | null; evSales?: number | null;
  pb?: number | null; peg?: number | null; netIncome?: number | null;
}

export interface MarketRegime {
  spyClose: number; spy200dma: number; spyAbove200: boolean; vix: number | null; futuresPct: number | null;
}

export interface MarketDataProvider {
  name: string;
  /** data-quality warnings accumulated during calls (missing data, retries, stale quotes) */
  warnings: string[];
  getUniverse(): Promise<UniverseMember[]>;
  getDailyBars(symbols: string[], from: string, to: string): Promise<Record<string, Bar[]>>;
  getQuotes(symbols: string[]): Promise<Record<string, Quote>>;
  getFundamentals(symbols: string[]): Promise<Record<string, Fundamentals>>;
  getEarningsDates(symbols: string[], from: string, to: string): Promise<Record<string, string>>;
  getMarketRegime(): Promise<MarketRegime>;
  getHistoricalFundamentals?(symbols: string[]): Promise<Record<string, HistoricalFundamentals[]>>;
}

export interface MomentumFeatures {
  ret12_1: number; ret6m: number; ret3m: number; rsVsSpy6m: number; high52Proximity: number;
  sma50: number; sma200: number; rsi14: number; close: number; aboveMAs: boolean; avgDollarVol30d: number;
}

export interface MomentumResult { symbol: string; score: number; features: MomentumFeatures }

export type MetricKey = "fwdPE" | "evEbitda" | "pFcf" | "evSales" | "peg" | "pb" | "pffoOrPe";
export type Metrics = Partial<Record<MetricKey, number | null>>;

export interface ValuationResult {
  symbol: string; score: number | null; validMetrics: number;
  metricPercentiles: Partial<Record<MetricKey, number>>; excludedReason?: string;
}

export interface ReportRow {
  rank: number; symbol: string; name: string; sector: string; price: number;
  preMarketPct: number | null; momentumScore: number; valuationScore: number;
  fwdPE: number | null; evEbitda: number | null; pFcf: number | null;
  ret6m: number; pctFromHigh: number; rsi: number; nextEarnings: string | null;
  why: string; flags: string[];
}

export interface ReportData {
  isMock?: boolean;
  runDate: string; generatedAt: string; dataTimestamp: string;
  regime: MarketRegime; rows: ReportRow[];
  newEntrants: string[]; droppedOut: string[]; warnings: string[];
}
