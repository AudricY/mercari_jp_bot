# eBay Collection

Scheduled collection of eBay listings (default: US video-game vertical),
extending the market-collection idea beyond Mercari. Unlike the Mercari path,
this uses eBay's **official Buy Browse API** with an application OAuth token —
no scraping, no DPoP.

## Prerequisites

1. Create an app at <https://developer.ebay.com> (free tier: 5,000 Browse API
   calls/day) and grab the production keyset.
2. Set env: `EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET`, `EBAY_SCAN_ENABLED=true`.
   The scanner logs a warning and stays off when credentials are missing, so
   the app runs fine without them.

## What runs

`apps/unified/src/ebay-scanner.ts` runs its own loop (started from `index.ts`,
tick `EBAY_SCAN_TICK_SECONDS`, default 60s) and executes two job types per
enabled query, all through `EbayRequestScheduler` (serialized, min-delay,
429 cooldown — same contract as `MercariRequestScheduler`):

| Job | What it does | Writes |
|---|---|---|
| `new_sweep` | Pages `sort=newlyListed` until the per-query `itemCreationDate` cursor; first run takes 1 page to seed the cursor | upserts `ebay_listings` |
| `snapshot` | Full sweep of the query result set; afterwards flips unseen `on_sale` rows to `gone` | upserts + gone marking |

There is **no sold sweep**: sold/completed prices need the Marketplace
Insights API, which eBay gates behind a business approval. `gone` means the
listing ended (sold, expired, or delisted — the Browse API cannot tell which).
If Marketplace Insights access is ever granted, a `sold_sweep` job mirroring
the Mercari one is the natural extension.

Queries live in `catalog/ebay-queries.yaml` (synced into `ebay_queries` at
startup and on `POST /v1/config/reload`). Each query is keyword and/or
category scoped; the starter catalog filters to `buyingOptions:{FIXED_PRICE}`
so asking prices stay comparable with Mercari (no auction bid noise).
Useful category ids: 139971 = Video Game Consoles, 139973 = Video Games.

## Data model

- `ebay_queries` — query registry + job cursors/timestamps (id = catalog slug).
- `ebay_listings` — one lean row per unique eBay item: price (Decimal, with
  currency), condition, seller, buying options, `itemCreationDate`. Status
  lifecycle: `on_sale` → `gone`. Items seen by multiple queries stay attached
  to the first query that collected them.

Analytics endpoints/rollups (daily stats, read API) are not built yet;
follow the `daily_category_market_stats` pattern when they're needed.

## API constraints worth knowing

- Page size max 200; `offset + limit` capped at 10,000 per query — a snapshot
  can only ever see the 10k newest matches. Keep queries narrow (keyword +
  category) rather than category-only.
- App tokens expire after ~2h; `EbayClient` caches and refreshes transparently
  and retries once on a mid-flight 401.
- Default free quota is 5,000 calls/day. The starter catalog (6 queries,
  daily snapshots, hourly new sweeps on 3) is worst-case ~1.6k calls/day only
  if every snapshot hits the 10k window cap; typically far less.

## Env knobs

| Var | Default | Meaning |
|---|---|---|
| `EBAY_SCAN_ENABLED` | `false` | Master switch |
| `EBAY_CLIENT_ID` / `EBAY_CLIENT_SECRET` | empty | Developer keyset (required) |
| `EBAY_MARKETPLACE_ID` | `EBAY_US` | Default marketplace; per-query override in catalog |
| `EBAY_ENVIRONMENT` | `production` | `production` or `sandbox` |
| `EBAY_SCAN_TICK_SECONDS` | `60` | Loop tick |
| `EBAY_SCAN_PAGE_SIZE` | `200` | Browse API max |
| `EBAY_SCAN_MAX_PAGES_PER_JOB` | `50` | Cost cap per sweep (50 × 200 = the 10k window) |
| `EBAY_SCAN_FAILURE_BACKOFF_SEC` | `900` | Per-job backoff after failure |
| `EBAY_SEARCH_MIN_DELAY_MS` | `1000` | Min delay between API calls |
| `EBAY_RATE_LIMIT_COOLDOWN_MS` | `90000` | Cooldown after a 429 |

## Ops

Initial backfill (or manual catch-up):

```bash
docker compose exec -T app pnpm --filter @mercari-bot/unified run ebay-scan-once
# or limit to specific query ids:
docker compose exec -T app pnpm --filter @mercari-bot/unified run ebay-scan-once -- us-ps3-console
```

`ebay-scan-once` ignores `EBAY_SCAN_ENABLED` (running it is the explicit
intent) but still requires credentials.
