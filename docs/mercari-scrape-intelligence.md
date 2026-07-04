# Mercari Scrape Intelligence (2026-07-05)

Findings from capability probing (`scripts/mercari-capability-probe.ts`, ~120
gently-paced requests from a residential IP, zero 429s). This document answers
"what is worth scraping on a schedule" for comprehensive game/software/console
market data.

## API capabilities confirmed

All via the existing anonymous DPoP-signed `POST /v2/entities:search` client
(`searchMercari` in `packages/core/src/scrape.ts`):

| Capability | Result |
|---|---|
| Sold-item search | `status: ["STATUS_SOLD_OUT"]` works anonymously. Items carry final price, `created`, `updated` (≈ sale/last-touch time), condition, seller. `STATUS_TRADING` = sold-but-in-progress. |
| Pagination | `pageToken` format `v1:<page>` — plain page numbers, jumpable. `pageSize` up to 120. `meta.numFound` gives totals (caps at 15000). |
| Keyword-less browse | Empty keyword + `categoryId` returns the whole category, newest first. No keyword curation needed. |
| Sorts / filters | `SORT_PRICE` asc/desc, `SORT_CREATED_TIME` desc, `SORT_NUM_LIKES` desc; `itemConditionId` filter works (1=new … 6=bad). |
| Search-hit fields | Each hit includes `id`, `name`, `price`, `status`, `created`, `updated`, `categoryId` (leaf), `itemConditionId`, `sellerId`, `shippingPayerId`, `shippingMethodId`, `itemType`, `thumbnails`. The legacy scanner discarded everything but title/price/id/thumbnail. |
| Item detail | `GET /items/get?id=` adds description, `num_likes`, `num_comments`, full category path (`item_category_ntiers` + `parent_categories_ntiers`), seller ratings, photos. |
| Category master | `GET /services/master/v1/itemCategories` returns the **legacy** tree only (max id 1410). The live search taxonomy ("ntiers") is deeper; resolve unknown leaf names lazily via one item-detail call per leaf. |

## Video-game category taxonomy (ntiers)

`1328 ゲーム・おもちゃ・グッズ → 76 テレビゲーム → platform → product-type leaf`:

| Platform | Platform ID | 本体 (console) | ソフト (software) | Accessories |
|---|---|---|---|---|
| Nintendo Switch | 7002 | 701 (Switch), 703 (Lite) | 702 | 7007 周辺機器 → 7008 case, 7009 controller, … |
| Nintendo Switch 2 | 7013 | (sibling of 7015, unresolved) | 7015 | |
| PS5 | 6983 | (sibling of 6985) | 6985 | |
| PS4 | 6987 | 6988 | 6989 | |
| PS3 | 7090 | 7091 | 7092 | |
| 3DS/2DS | 7021 | — | 704 | |
| DS | 7049 | — | 7051 | |
| Wii | 7103 | — | 7105 | |
| その他機種 (retro) | 7135 | per-platform children | PS2 7136→7145, GBA 7171→7172, GB 7179→7180, SFC 7187→7188, FC 7199→7200 | 7231 その他 |

Filtering by a platform ID returns everything beneath it; filtering by a leaf
returns just that product type. Search hits carry the leaf `categoryId`, so
one browse of `76` reveals every active leaf.

## Market volumes (probed 2026-07-05)

| Category | On sale | Sold index | Est. new listings/day |
|---|---:|---:|---:|
| 702 Switch ソフト | 8,822 | 8,428 | ~1,700 |
| 7015 Switch 2 ソフト | 1,191 | 2,034 | ~680 |
| 6985 PS5 ソフト | 2,077 | 1,951 | ~670 |
| 6989 PS4 ソフト | 4,000 | 1,180 | — |
| 7092 PS3 ソフト | 2,092 | 240 | low |
| 704 3DS/2DS ソフト | 4,913 | 1,576 | low |
| 7051 DS ソフト | 5,093 | 1,218 | low |
| 7105 Wii ソフト | 1,287 | 253 | — |
| 7145 PS2 ソフト | 4,615 | 556 | ~110 |
| 7172 GBA ソフト | 2,049 | 512 | ~500* |
| 7180 GB ソフト | 3,019 | 576 | ~220* |
| 7188 SFC ソフト | 4,171 | 647 | — |
| 7200 FC ソフト | 4,479 | 783 | — |
| 701 Switch 本体 | 883 | 829 | ~660* |
| 703 Switch Lite 本体 | 285 | 407 | ~80 |
| 6988 PS4 本体 | 341 | 382 | ~24 |
| 7091 PS3 本体 | 343 | 194 | ~19 |
| **Total** | **~45k** | **~22k** | |

\* first-page `created` spans are noisy (relist boosting); treat as upper bounds.

Other observations:

- **`numFound` badly undercounts** (verified 2026-07-05 during the first real
  collection run): category 7091 reported numFound=343 on sale but paging
  yielded 2,166 genuine leaf-tagged on-sale items; the sold+trading sweep
  yielded 11,919 items against a reported sold "index" of 194. Treat the table
  above as lower bounds and rely on page caps, not numFound, to bound cost.
- Switch software on-sale inventory turns over in ~8 days (offset-probe of
  page 73/74 showed oldest on-sale items ~8 days old).
- Sold results sort only by listing `created`, not sale time, so capturing
  all sales requires a full sweep of a category's sold index; sweeping daily
  and stamping `sold_observed_at` on first sight approximates sale dates to
  within one sweep interval.
- Past the true result set Mercari pads search pages with "similar item"
  recommendations; filter hits by their own `categoryId` and stop when a page
  contains no matching items.

## Request-budget math

Safe production ceiling (2026-06-28 VPS probe): 1250ms/search ≈ 48 req/min,
~69k req/day theoretical. Scheduled comprehensive collection costs:

| Job | Frequency | Requests/day |
|---|---|---:|
| Full on-sale snapshot, all 17 leaves (45k items / 120 per page) | daily | ~375 |
| Full sold sweep, all 17 leaves (22k / 120) | daily | ~185 |
| New-listings sweep, high-velocity leaves (delta pages only) | hourly | ~100–200 |
| Existing keyword alert scans | unchanged | ~3,000–5,000 |

Total added load ≈ **700–800 requests/day ≈ 2% of budget**. Comprehensive
collection of the entire video-game vertical is cheap; the binding constraint
is SQLite storage/indexing discipline, not the API.

## What is worth scraping on a schedule

1. **Daily sold sweep per leaf** — the highest-value data: real transaction
   prices with condition, platform, and sale-time approximation. Enables
   sold-price distributions, sell-through rate, and asking-vs-sold spread.
2. **Daily full on-sale snapshot per leaf** — inventory levels, asking-price
   distributions, stale-inventory detection.
3. **Hourly new-listings delta sweep** for high-velocity leaves (702, 7015,
   6985, 701) — near-real-time discovery feeding both analytics and the
   existing bargain-alert pipeline.
4. **Not worth scheduling**: item-detail fetches in bulk (3s/req budget, adds
   description/likes only), accessory categories (out of scope), PC games 705
   (tiny, 59 items).
