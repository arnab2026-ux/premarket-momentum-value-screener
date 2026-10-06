-- Pre-Market Momentum-Value Screener schema.
-- All access is server-side with the service-role key (bypasses RLS). RLS is enabled with
-- no policies so the anon/authenticated keys can read nothing.

create table if not exists runs (
  run_date     date primary key,
  status       text not null check (status in ('running','success','failed')),
  attempts     int  not null default 0,
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  error        text,
  meta         jsonb
);

create table if not exists universe_snapshots (
  run_date        date not null,
  symbol          text not null,
  name            text,
  sector          text,
  price           numeric,
  market_cap      numeric,
  adv_usd         numeric,
  passed_filters  boolean not null,
  reject_reason   text,
  primary key (run_date, symbol)
);

-- Full scored universe per day (every stock that reached momentum scoring) for audit / backtests.
create table if not exists scores (
  run_date         date not null,
  symbol           text not null,
  momentum_score   numeric,
  valuation_score  numeric,            -- only populated for the momentum pool
  in_pool          boolean not null default false,
  final_rank       int,                -- 1..N if it made the report
  excluded_reason  text,
  features         jsonb,              -- returns, MAs, RSI, 52w proximity ...
  metrics          jsonb,              -- valuation multiples + per-metric percentiles
  primary key (run_date, symbol)
);
create index if not exists scores_rank_idx on scores (run_date, final_rank) where final_rank is not null;

create table if not exists reports (
  run_date     date primary key,
  html         text not null,
  csv          text not null,
  rows         jsonb not null,
  regime       jsonb,
  warnings     jsonb,
  top_tickers  text[] not null,
  recipient    text,
  resend_id    text,
  sent_at      timestamptz,
  created_at   timestamptz not null default now()
);

create table if not exists errors (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  run_date    date,
  stage       text,
  message     text,
  detail      jsonb
);

-- Admin-editable overrides deep-merged over config/screener.config.ts
create table if not exists app_config (
  id          int primary key check (id = 1),
  config      jsonb not null,
  updated_at  timestamptz not null default now()
);

alter table runs               enable row level security;
alter table universe_snapshots enable row level security;
alter table scores             enable row level security;
alter table reports            enable row level security;
alter table errors             enable row level security;
alter table app_config         enable row level security;
