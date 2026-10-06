/**
 * Single source of truth for all tunables. Admin page edits are stored in
 * Supabase (app_config) and deep-merged over these defaults at runtime.
 */
export const defaultConfig = {
  recipientEmail: "arnab19882009@gmail.com",
  timezone: "America/New_York",
  runTime: { hour: 8, minute: 30, toleranceMinutes: 5 },
  retry: { attempts: 3, backoffMs: [5_000, 20_000] },

  universe: {
    /** "top_mcap" = top-N US common stocks by market cap (Russell 1000 proxy).
     *  "csv" = read tickers from config/universe-override.csv (one symbol per line). */
    source: "top_mcap" as "top_mcap" | "csv",
    size: 1000,
    exchanges: ["NYSE", "NASDAQ"],
    minPrice: 5,
    minMarketCap: 2_000_000_000,
    minAvgDollarVolume30d: 20_000_000,
  },

  momentum: {
    weights: { ret12_1: 0.3, ret6m: 0.25, ret3m: 0.15, rsVsSpy6m: 0.15, high52Proximity: 0.15 },
    poolSize: 150,
    requireAboveMAs: true,
    rsiOverextended: 80,
  },

  valuation: {
    /** peer percentiles are computed inside the momentum pool; sectors thinner than minPeers use the whole pool */
    minPeers: 8,
    minValidMetrics: 3,
    maxMultiple: 1000, // multiples above this are treated as meaningless
    weights: { fwdPE: 0.25, evEbitda: 0.3, pFcf: 0.25, evSales: 0.1, peg: 0.1 },
    /** Financials / REITs: EV/EBITDA and P/FCF swapped for P/B and P/FFO (REIT) or trailing P/E */
    financialWeights: { fwdPE: 0.3, pb: 0.3, pffoOrPe: 0.25, peg: 0.15 },
    financialSectors: ["Financial Services", "Financials", "Real Estate"],
  },

  ranking: {
    topN: 30,
    maxPerSector: 6,
    maxDebtToEbitda: 4,
    /** gaps in pre-market price vs prior close that get flagged */
    gapFlagPct: 3,
  },

  /** Regime / backtest */
  backtest: { years: 3, costBps: 10 },
};

export type ScreenerConfig = typeof defaultConfig;
