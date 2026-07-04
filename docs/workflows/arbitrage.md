# Arbitrage (Mercari JP → eBay US)

Cross-marketplace resale analysis for video-game consoles and software: buy
on Mercari JP, export via a proxy service, sell on eBay US. Built on top of
the two collection pipelines — Mercari market collection
(`docs/workflows/market-collection.md`) supplies acquisition prices and sold
velocity; eBay collection (`docs/workflows/ebay-collection.md`) supplies
revenue comps. No collection of its own: if a product's categories/queries
aren't being collected, its report is empty.

## The model

Per product (defined in `catalog/arbitrage-products.yaml`, synced into
`arbitrage_products` at startup and on `POST /v1/config/reload`):

- **Buy side (Mercari)** — listings in the product's `mercari.category_ids`
  whose titles match `mercari.aliases` minus `mercari.exclude` (same
  normalization as the item catalog). Stats: cheapest/median live asking,
  median sold and sold count over 30 days.
- **Sell side (eBay)** — collected `ebay_listings` whose titles match
  `ebay.aliases` minus `ebay.exclude`; `ebay.require_any` (e.g. "japan")
  keeps only Japan-import comps. Stats: lowest/median live USD, listings
  gone in 30 days (demand proxy — the Browse API can't distinguish sold from
  delisted).
- **Economics** (`packages/core/src/arbitrage.ts`, pure functions) — landed
  cost = (price × (1+proxy%) + proxy flat + JP shipping) / FX + intl
  shipping by `shipping_class`; net proceeds = eBay median × (1 − FVF% −
  ad%) − fixed fee. Yields margin, ROI, breakeven buy price, and a
  **max-buy price** at `target_roi_pct`.
- **Verdict** — `buy` (cheapest live ≤ effective max-buy), `watch` (margin
  > 0), `skip`, `no_data`. Effective max-buy = `max_buy_jpy_override` if
  set, else the derived max-buy.

The fee model lives in the `economics:` block of the catalog — margins are
only as honest as those numbers; tune them to your proxy service and
shipping reality. FX: pinned via `ARBITRAGE_FX_JPY_PER_USD`, else live from
frankfurter.app (cached 12h), else `fx_jpy_per_usd_fallback`.

## Surfaces

- `GET /v1/analytics/arbitrage/opportunities?sort=roi|margin` — ranked list
  (admin auth like other analytics endpoints).
- `GET /v1/analytics/arbitrage/products/:slug` — full drilldown: economics
  breakdown, top-10 cheapest Mercari live (with per-listing landed/margin/
  ROI), recent sold, top-10 cheapest eBay comps.
- **Dashboard** — `/arbitrage` in analytics-web (list + per-product detail).
- **Telegram buy alerts** — when the market scanner ingests a fresh Mercari
  listing matching a product at or below its effective max-buy, a message is
  sent (optionally to forum topic `ARBITRAGE_ALERT_TOPIC_NAME`). Latency ≈
  the category's `new_sweep_interval_sec` plus the alert check interval, so
  give alert-worthy categories fast new sweeps. Dedupe is in-memory: a
  restart may re-alert on listings first seen after startup.

## Env knobs

| Var | Default | Meaning |
|---|---|---|
| `ARBITRAGE_ALERTS_ENABLED` | `false` | Telegram buy alerts |
| `ARBITRAGE_ALERT_CHECK_SECONDS` | `120` | Alert loop tick |
| `ARBITRAGE_ALERT_TOPIC_NAME` | empty | Forum topic for alerts (else chat root) |
| `ARBITRAGE_CACHE_TTL_SEC` | `300` | Opportunities report cache |
| `ARBITRAGE_FX_JPY_PER_USD` | `0` | Manual FX pin; 0 = live fetch |

## Adding a product

1. Make sure both sides are collected: the Mercari leaf category is in
   `catalog/market-categories.yaml` and an eBay query covering the comps is
   in `catalog/ebay-queries.yaml`.
2. Add the product to `catalog/arbitrage-products.yaml` (aliases in both
   languages; excludes for junk/bundles/repros; `require_any` for JP-import
   filtering on eBay).
3. `POST /v1/config/reload` (or restart).

## Caveats

- eBay comps are **asking** prices (median live), not sold prices — sold data
  needs the gated Marketplace Insights API. Median-live overstates realized
  revenue slightly; the conservative lever is `target_roi_pct`.
- Mercari `sold` stamps approximate sale time to within a sweep interval,
  and the first sold sweep backfills history into day one (see
  market-collection caveats).
- Title matching is substring-based: aliases must be distinctive, excludes
  must carry the disqualifiers (ジャンク, box-only, repro, …). Audit each
  product's detail page after adding it.
