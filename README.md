# Pre-Market Momentum-Value Screener

Emails a daily HTML report (+ CSV) of the 30 most undervalued stocks among the highest-momentum US equities, at **08:30 America/New_York** on NYSE trading days. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the data flow and [docs/sample-email.html](docs/sample-email.html) for a rendered sample (mock data).

## Assumptions and open decisions (defaults chosen; all configurable)

1. **Universe**: FMP has no licensed Russell 1000 membership list. Default = top 1000 US common stocks (NYSE/Nasdaq) by market cap, excluding ETFs/funds, ADR/ADS names, SPAC/shell names and OTC. For a true Russell 1000 / S&P 500+400 list, set `universe.source = "csv"` and provide `config/universe-override.csv` (one ticker per line; profiles are fetched from FMP; exchange is expected as `NYSE`/`NASDAQ` in FMP's profile).
2. **Valuation peers** = sector buckets inside the 150-name momentum pool (thin buckets fall back to whole pool).
3. **Forward P/E** = price / next-unreported-fiscal-year consensus EPS (FMP `analyst-estimates`).
4. **Pre-market %** only when the quote timestamp is from today; otherwise blank. FMP's pre-market coverage is limited; Polygon is better here (write a `PolygonProvider`).
5. **Earnings red flag** = loss-making with no positive forward EPS. **Going-concern flag** = Altman Z < 1 or negative equity, combined with negative FCF (no true auditor going-concern data in FMP). Debt/EBITDA guard (default 4x) skipped for financials/REITs.
6. **Early-close days** run normally. NYSE holidays are computed by rule (incl. Good Friday, Juneteenth, observed-date shifts), no hardcoded list to maintain.
7. **Cron precision**: Vercel Hobby cron only guarantees hour-level precision; use **Pro** (minute-level, `maxDuration` 300s) or move the trigger to GitHub Actions / Supabase pg_cron hitting `/api/cron`.

## Setup

```bash
npm install
cp .env.example .env.local          # fill in values
npm test                            # 31 unit tests
npm run dry-run                     # mock data -> out/report-<date>.html (+ .csv); no DB, no email
npm run dry-run -- --provider=fmp --limit=50   # live-data smoke test (needs FMP_API_KEY)
npm run backtest                    # mock; use -- --provider=fmp for real
npm run dev                         # admin at http://localhost:3000/admin
```

### Environment variables

| Var | Purpose |
|---|---|
| `DATA_PROVIDER` | `fmp` (default) or `mock` |
| `FMP_API_KEY` | Financial Modeling Prep key (Premium tier recommended: ~1,600 calls/run) |
| `FUTURES_SYMBOL` | S&P futures symbol for regime header (default `ES=F`; verify against your FMP plan) |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Storage (server-side only; never expose the key) |
| `RESEND_API_KEY`, `EMAIL_FROM` | Email. `EMAIL_FROM` must be on a domain verified in Resend |
| `REPORT_RECIPIENT` | Optional override of `recipientEmail` in config |
| `CRON_SECRET` | Vercel sends it as `Authorization: Bearer …`; the route rejects anything else |
| `ADMIN_USER`, `ADMIN_PASSWORD` | Basic auth for `/admin` (fails closed if password unset) |

## Deployment (Vercel + Supabase + Resend)

1. **Supabase**: create a project, run `supabase/migrations/0001_init.sql` (SQL editor or `supabase db push`).
2. **Resend**: verify your sending domain, create an API key.
3. **Vercel**: import the repo, add all env vars above, deploy. `vercel.json` registers two crons (`30 12 * * 1-5` and `30 13 * * 1-5` UTC): one is 08:30 ET in summer, the other in winter; the job exits unless NY time is 08:30 ±5 min.
4. **Test**: `curl -H "Authorization: Bearer $CRON_SECRET" "https://<app>/api/cron?force=1"` runs immediately (bypasses the time/holiday gate; email is still de-duplicated per date).
5. Open `/admin` to see reports, runs, errors, and edit config (JSON, validated; applies next run).

## Behavior notes

* Idempotent per trading date; up to 3 attempts (5s, 20s backoff); on final failure a short alert email is sent and the error is stored.
* API failures per symbol are skipped and logged as data-quality warnings (shown in the email and `reports.warnings`); stale (>4 days) or short-history symbols are rejected with a reason in `universe_snapshots`.
* RSI > 80 is flagged "Overextended", never excluded. Pre-market gap > ±3% and earnings today/this week are flagged.

## Backtest (`npm run backtest`)

Month-end rebalance over 3 years, equal-weight top 30, 10 bps per side on replaced names, vs SPY and vs a momentum-only top-30. Reports CAGR, Sharpe (rf = 0), max drawdown, hit rate (% of months beating SPY).
**Read the results sceptically**: universe is today's constituents (survivorship bias), valuation uses period-end ratios lagged 60 days, trailing P/E stands in for forward P/E, no historical market-cap filter. Mock-data output only proves the machinery works (the synthetic prices have persistent drifts, so momentum looks unrealistically good).

## Known gaps / next steps

* FMP field names (`key-metrics-ttm`, `ratios-ttm`, etc.) were written from the stable-API docs and **not exercised against a live key** in this environment; run the `--provider=fmp --limit=50` smoke test first and adjust `src/lib/providers/fmp.ts` if any field comes back null.
* Supabase persistence, Resend sending and Vercel cron were not run end-to-end here (no credentials); the pipeline, scoring, rendering, calendar logic, backtest and build are tested locally.
* Not investment advice.
