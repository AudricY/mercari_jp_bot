# Market Collection

Comprehensive scheduled collection of Mercari's video-game vertical
(software, consoles) — separate from, and additive to, the keyword
bargain-alert pipeline. Background and probe data: `docs/mercari-scrape-intelligence.md`.

## What runs

`apps/unified/src/market-scanner.ts` runs its own loop (started from
`index.ts`, tick `MARKET_SCAN_TICK_SECONDS`, default 60s) and executes three
job types per enabled category, all through `MercariRequestScheduler` (one
page per queue slot, so keyword alert scans interleave freely):

| Job | What it does | Writes |
|---|---|---|
| `new_sweep` | Pages newest on-sale listings until the per-category `created` cursor; first run takes 1 page to seed the cursor | upserts `market_listings` |
| `sold_sweep` | Full sweep of the sold+trading index; stamps `sold_price`/`sold_observed_at` the first time an item is seen sold | upserts + sold stamps |
| `snapshot` | Full sweep of the on-sale index; afterwards flips unseen `on_sale` rows to `gone` | upserts + gone marking |

Job schedules and the category set live in `catalog/market-categories.yaml`
(synced into `market_categories` at startup and on `POST /v1/config/reload`).
Category IDs are Mercari "ntiers" leaf ids.

Daily maintenance (same trigger as the existing daily stats) also refreshes
`daily_category_market_stats` — per category per UTC day: on-sale count, new
listings, sold count, asking/sold price percentiles.

## Data model

- `market_categories` — category registry + job cursors/timestamps.
- `market_listings` — one lean row per unique Mercari listing (no raw JSON):
  current price/status/condition/seller plus terminal `sold_price` and
  `sold_observed_at`. Status lifecycle: `on_sale` → `trading` → `sold_out`,
  or `on_sale` → `gone` (vanished from a completed snapshot).
- `daily_category_market_stats` — rollups for timeseries queries.

## Read API (admin auth, same as other analytics endpoints)

- `GET /v1/analytics/market/categories` — overview incl. median asking vs
  sold and the spread.
- `GET /v1/analytics/market/categories/:id/price-distribution?status=on_sale|sold&days=&buckets=`
- `GET /v1/analytics/market/categories/:id/timeseries?from&to&granularity=day|week|month`
- `GET /v1/analytics/market/categories/:id/listings?status=&sort=newest|cheapest|recently_sold&q=&limit=&offset=`
- `GET /v1/analytics/market/search?q=&status=on_sale|sold|all` — cross-category
  title search with asking/sold stats ("what does X actually sell for").

## Env knobs

| Var | Default | Meaning |
|---|---|---|
| `MARKET_SCAN_ENABLED` | `true` | Master switch |
| `MARKET_SCAN_TICK_SECONDS` | `60` | Loop tick |
| `MARKET_SCAN_PAGE_SIZE` | `120` | Mercari max observed |
| `MARKET_SCAN_MAX_PAGES_PER_JOB` | `200` | Hard cost cap per sweep (~24k items) |
| `MARKET_SCAN_FAILURE_BACKOFF_SEC` | `900` | Per-job backoff after failure |

Budget: with the default catalog (17 categories, daily snapshot + daily sold
sweep, hourly new sweeps on 4 high-velocity leaves) worst case is ~4k
search requests/day ≈ 85 min of the 48 req/min ceiling. On a 429 the shared
scheduler cooldown applies and the scan cycle stops starting new jobs.

## Ops

Initial backfill (or manual catch-up), run on the VPS after deploy:

```bash
docker compose exec -T app pnpm --filter @mercari-bot/unified run market-scan-once
# or limit to specific category ids:
docker compose exec -T app pnpm --filter @mercari-bot/unified run market-scan-once -- 7091 6988
```

Caveats:

- The first sold sweep stamps every historical sold item with
  `sold_observed_at = now`, so day-one sold counts/medians describe the whole
  backfilled sold window, not one day. Real per-day sold data accrues from
  day two.
- `sold_observed_at` approximates sale time to within one sweep interval.
- Storage: ~14k rows ≈ 3 MB (PS3 本体 test). Full catalog steady state is a
  few hundred MB/year on the 45 GB disk; revisit pruning `gone`/old `sold_out`
  rows if it grows past that.
