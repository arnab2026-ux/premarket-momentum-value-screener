# Architecture

```
 Vercel Cron (12:30 UTC + 13:30 UTC, Mon-Fri)
        │  GET /api/cron   (Bearer CRON_SECRET)
        ▼
 runDaily()  ── NY clock = 08:30 ±5m?  NYSE trading day?  ── no ──▶ exit "skipped"
        │ yes
        ▼
 claimRun(run_date)  ── already success / running <15m ──▶ exit (idempotent)
        │
        ▼   up to 3 attempts, backoff 5s / 20s ──── all fail ──▶ errors table + failure-alert email
 runPipeline()
   1. Universe        provider.getUniverse()  → price / mcap / exchange filters
   2. Price history   provider.getDailyBars() → staleness, 30d $-volume, min-history filters
   3. Momentum        percentile-rank 5 features over the whole eligible universe
                      → weighted score → require close > SMA50 & SMA200 → top 150 = pool
   4. Valuation       fundamentals + estimates for the pool only
                      → per-metric sector percentile (lower multiple = better), drop invalid, re-weight, need ≥3
   5. Ranking         quality guards → sort by valuation → sector cap (6) → top 30
   6. Enrichment      pre-market quote %, next earnings, flags, "why" line, regime (SPY/200DMA, VIX, futures)
   7. Diff            new entrants / dropped vs previous report (reports.top_tickers)
        │
        ▼
 renderHtml() + toCsv()  →  persistScores() (universe_snapshots, scores)  →  Resend (HTML + CSV)  →  persistReport()
```

## Module map

| Path | Responsibility |
|---|---|
| `config/screener.config.ts` | Every tunable (weights, thresholds, universe, recipient). Admin edits deep-merge over it via `app_config`. |
| `src/lib/providers/` | `MarketDataProvider` interface; `fmp.ts` (live), `mock.ts` (deterministic synthetic), `index.ts` factory. Swap vendors here only. |
| `src/lib/scoring/` | Pure functions: `percentile`, `momentum`, `valuation`, `ranking`. No I/O, fully unit-tested. |
| `src/lib/pipeline.ts` | Orchestrates the steps above; returns report + full scored universe. No DB/email. |
| `src/lib/run-daily.ts` | Scheduling guard, idempotency, retries, persistence, email, failure alert. |
| `src/lib/report/` | HTML (inline-styled, mobile scroll) and CSV rendering, "why" line, flags. |
| `src/lib/backtest.ts`, `scripts/backtest.ts` | Monthly-rebalance backtest vs SPY. |
| `src/app/admin/*`, `src/middleware.ts` | Basic-auth admin: past reports, runs/errors, config editor. |
| `supabase/migrations/0001_init.sql` | `runs`, `universe_snapshots`, `scores`, `reports`, `errors`, `app_config`. |

## Key design decisions

* **DST**: two UTC crons are registered; the job itself reads the New York wall clock (Intl) and only the one that lands in 08:30 ±5 min proceeds. Verified by tests for EDT, EST and both switch weeks.
* **Idempotency**: `runs.run_date` is the primary key; success short-circuits. Resend `Idempotency-Key` prevents duplicate emails if a retry happens after a successful send.
* **Percentiles over the full universe, MA gate afterward**: the score reflects relative strength vs everyone eligible; the gate only decides who may enter the pool.
* **Valuation peers = momentum pool (sector buckets)**: keeps fundamentals calls to ~150 symbols. Buckets with < `minPeers` valid values for a metric fall back to the whole pool. Set `universe`-wide peers later by fetching fundamentals for all names.
* **Financials/REITs** use Fwd P/E, P/B, P/FFO (REIT; FMP lacks it, so P/FCF proxy) or trailing P/E, and PEG.
* **Audit trail**: every scored stock per day is stored with its features, multiples and exclusion reason.
