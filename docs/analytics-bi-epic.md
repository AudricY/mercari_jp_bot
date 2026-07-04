# Analytics / BI Epic Spec

> **Status 2026-07-05**: this epic shipped (keyword/item dashboards on daily
> snapshot tables; `ListingObservation` was later replaced by daily rollups).
> The second analytics wave — comprehensive category-level market collection
> with sold-price data and the Market UI — is documented in
> `docs/workflows/market-collection.md` and `docs/mercari-scrape-intelligence.md`.
> This file is kept as historical context for phase-1 decisions.

Private business-intelligence dashboard for Mercari JP Bot. This document is a handoff spec for the next agent to implement the first analytics roadmap.

## Objective

Build a separate analytics app in the monorepo that answers market-intelligence questions for the bot owner.

Primary question:

- What is the price distribution of each keyword group over time?

Secondary questions:

- How many matching listings does each keyword produce over time?
- How do daily / weekly / monthly price distributions move?
- What are the cheapest recent listings for each keyword?
- Which keywords have useful coverage versus weak coverage?

Out of scope for this epic:

- Technical / ops analytics
- Alert latency analysis
- Bargain detection
- Seller-level analytics
- Condition/model-level segmentation
- Multi-user auth/productization

## Product Decisions Already Made

- User: single private user only
- Analytics focus: market intelligence, not operational monitoring
- Grouping unit: existing `keyword`
- Source dataset: all scraped matching listings, not only notified listings
- Main UI surfaces: histogram, box-plot stats, cheapest listings table
- Time windows: daily, weekly, monthly
- History retention: keep all raw data
- App shape: separate app in monorepo
- Initial hosting: same VPS as the bot
- `SQLite` remains acceptable for MVP
- `Vercel` is not the initial deployment target for the analytics data layer

## Current System Context

### Repo / runtime

- Monorepo with one long-running unified app today:
  - `apps/unified/` = API + scheduler + scraper + notifier
  - `packages/core/` = config, metrics, scraping, types
  - `packages/db/` = Prisma client wrappers and keyword sync
  - `prisma/` = schema + migrations
- Stack: TypeScript, Fastify, Prisma, SQLite, Docker

### Existing business data

Current Prisma models:

- `Keyword`
- `Listing`
- `SeenListing`
- `ScanRun`
- `Notification`
- `DailyKeywordCount`
- `TelegramTopic`

Important facts from current schema and behavior:

- `Keyword` is the business grouping unit and should remain the primary analytics dimension for phase 1.
- `Listing` stores a canonical listing record with price, title, URL, and raw JSON payloads.
- `Notification` tracks bot delivery state.
- `DailyKeywordCount` tracks successful sends per day per keyword.
- `ScanRun` tracks job-level scan outcomes.

### Current analytics surfaces

Current reporting is operational, not BI-oriented:

- `/v1/runs/recent` exposes recent scan runs
- `/v1/stats/daily` exposes daily sent counts
- Prometheus metrics expose scan duration, found/new counts, notification counts, request failures

This means the current system is useful for bot health, but not sufficient for market analytics.

## Critical Data Modeling Constraint

The current `Listing` table is not a strong historical observation table for analytics.

Problem:

- `Listing` behaves like a canonical/latest listing record tied to a discovered item.
- BI needs repeated observations across time so price distributions can be analyzed by day/week/month.
- Relying only on `Listing` and `Notification` will bias analytics toward surfaced items and make history incomplete.

Conclusion:

- This epic should add a new observation/event table for analytics history.

## Proposed Analytics Data Model

### New table: `ListingObservation`

Add a new Prisma model for one row per scan hit.

Purpose:

- Preserve historical observations for every scraped listing that matched a keyword
- Support distribution analysis across time windows
- Decouple market analytics from notification logic

Proposed fields:

- `id`
- `keywordId`
- `listingId` nullable reference to canonical `Listing`
- `sourceListingId` nullable
- `listingUrl`
- `title`
- `currency`
- `numericPrice`
- `rawPriceDisplay`
- `observedAt`
- `scrapedAt` if needed separately, but likely one timestamp is enough for MVP
- `rawJson` optional snapshot copy or reference
- `createdAt`

Indexes to consider:

- `(keywordId, observedAt)`
- `(keywordId, numericPrice, observedAt)`
- `(sourceListingId)`
- `(listingId, observedAt)` if listing linkage is used heavily

### Existing tables kept as-is conceptually

- `Listing`: canonical/latest listing state
- `SeenListing`: dedupe / new-or-cheaper logic
- `Notification`: alert pipeline and sent-state tracking
- `ScanRun`: scan job audit
- `DailyKeywordCount`: can remain for alert summaries, but not as the main BI source

### No new dimensions in phase 1

Do not model these yet:

- seller
- product model
- condition
- normalized family/category hierarchy beyond `keyword`

They may be added later after the keyword-based BI loop proves useful.

## Ingestion Rules

### Source of truth

Analytics must use:

- all scraped matching listings that pass current keyword filters

Analytics must not use as primary source:

- only notifications
- only new-or-cheaper listings
- only successfully sent Telegram messages

### When to write `ListingObservation`

For each listing returned by scan logic after filters pass:

1. keep current canonical `Listing` upsert/update behavior
2. keep current `SeenListing` dedupe behavior
3. write a `ListingObservation` row regardless of whether the listing becomes a notification

This is the key behavior change required for BI.

### Expected consequences

- Observation volume will be materially higher than notification volume
- SQLite growth will increase
- Query design and indexing matter
- Raw history becomes available for proper distributions and trend charts

## Analytics Questions the MVP Must Answer

### Overview level

- Which keywords have the most listing activity?
- What is the current median price per keyword?
- How has volume changed recently?
- Which keywords are sparse/noisy versus dense/useful?

### Keyword detail level

- Current price distribution for a selected date range
- Daily / weekly / monthly trend for median price
- Daily / weekly / monthly trend for listing volume
- Cheapest recent listings
- Raw listing drilldown for validation

### Explicitly not required yet

- automated bargain scoring
- anomaly detection
- purchase recommendation engine
- seller quality analysis

## Analytics App Shape

Create a separate app in the monorepo.

Recommended path:

- `apps/analytics-web`

Recommended stack:

- Next.js or similar server-rendered React app is acceptable
- Keep it private and simple
- Server-side data fetching is preferred for MVP

Reason for separate app:

- keeps BI UI isolated from scraper/notifier runtime
- makes ownership and deployment boundaries cleaner
- avoids coupling dashboard concerns into the bot process

## Hosting Recommendation

Initial deployment:

- run analytics app on the same VPS as the bot

Reason:

- SQLite is already on the VPS
- simpler networking and auth
- easier iteration for a private single-user tool
- avoids exposing raw database access or wide read APIs too early

Future option:

- move frontend to `Vercel`
- keep read-only analytics API / data access on the VPS

Do not plan phase 1 around direct SQLite access from `Vercel`.

## API / Query Surface

The MVP needs read-only analytics queries. These can be implemented either:

- inside the existing unified app as new analytics endpoints, or
- inside a small dedicated analytics API surface

Phase 1 recommendation:

- implement read-only analytics endpoints in the existing backend first
- let the new analytics app consume those endpoints

This reduces duplicated DB access logic and keeps SQLite access local.

### Required endpoints

#### `GET /v1/analytics/keywords`

Returns:

- keyword list
- basic aggregates for default date window
- latest activity date

Possible fields:

- `keywordId`
- `keywordName`
- `observationCount`
- `uniqueListingCount`
- `medianPrice`
- `minPrice`
- `maxPrice`
- `latestObservedAt`

#### `GET /v1/analytics/keywords/:id/price-distribution`

Parameters:

- `from`
- `to`
- optional bucket count or bucket size

Returns:

- histogram buckets
- summary stats

Summary stats:

- `count`
- `min`
- `p25`
- `median`
- `p75`
- `max`
- optional `mean`

#### `GET /v1/analytics/keywords/:id/timeseries`

Parameters:

- `from`
- `to`
- `granularity=day|week|month`

Returns per bucket:

- `periodStart`
- `observationCount`
- `uniqueListingCount`
- `minPrice`
- `medianPrice`
- `p75Price`
- `maxPrice`

#### `GET /v1/analytics/keywords/:id/listings`

Parameters:

- `from`
- `to`
- sorting: `newest|cheapest`
- pagination

Returns:

- recent or cheapest observed listings for drilldown

Possible fields:

- `listingId`
- `sourceListingId`
- `title`
- `url`
- `imageUrl`
- `price`
- `observedAt`
- `keywordId`

## Dashboard Pages

### 1. Overview

Purpose:

- compare keywords quickly

Widgets:

- keyword table/cards
- recent observation counts
- median price by keyword
- latest activity
- links into keyword detail

### 2. Keyword Detail

Purpose:

- inspect one keyword’s market

Widgets:

- histogram
- box-plot summary stats panel
- daily/weekly/monthly trend toggle
- listing volume trend
- cheapest recent listings table
- recent listings table

### 3. Listings Explorer

Purpose:

- validate the data behind a keyword’s distribution

Filters:

- keyword
- date range
- price range
- sort order

## Performance / Storage Strategy

`SQLite` is acceptable for MVP if queries stay disciplined.

Guidelines:

- use `ListingObservation` as base fact table
- add targeted indexes during schema design
- keep query windows bounded by date range
- compute rollups later only if needed

Do not prematurely introduce:

- warehouse infrastructure
- external OLAP databases
- event streaming
- Vercel-hosted DB access

### Rollups

If query performance becomes weak, add summary tables later:

- `daily_keyword_market_stats`
- maybe weekly/monthly pre-aggregates

These are optimization layers, not phase-1 requirements.

## Implementation Plan

### Phase 1 — Data foundation

Deliverables:

- Prisma schema change adding `ListingObservation`
- migration
- scanner ingestion updates to write one observation per matching scan hit
- build/typecheck/tests updated as needed

Acceptance criteria:

- every matching scraped listing creates an observation row
- notification behavior remains unchanged
- existing alert workflow still works

### Phase 2 — Analytics queries / API

Deliverables:

- query helpers for distribution, timeseries, and listing drilldown
- read-only analytics endpoints
- sensible defaults for date windows

Acceptance criteria:

- overview and keyword detail can be powered entirely from endpoints
- daily/weekly/monthly grouping works
- median/p25/p75/min/max are returned correctly

### Phase 3 — Analytics web app

Deliverables:

- `apps/analytics-web`
- overview page
- keyword detail page
- listings explorer

Acceptance criteria:

- private single-user dashboard is usable on the VPS
- pages load from backend analytics endpoints
- core charts/tables answer the main BI questions

### Phase 4 — Optimization / polish

Deliverables:

- caching or rollups if required
- export helpers if useful
- UI improvements

Acceptance criteria:

- dashboard remains responsive with production data volumes

## Open Design Choices for Implementer

These are intentionally left for the next agent to resolve:

- exact framework for `apps/analytics-web`
- whether analytics endpoints live in `apps/unified` or a small dedicated backend module
- exact percentile computation strategy in SQLite
- whether histogram bucketing is fixed-width or dynamic
- whether observation rows duplicate some listing fields for denormalized query speed

Default guidance:

- choose the simplest solution that keeps MVP delivery fast and maintainable
- prefer denormalization if it materially simplifies SQLite analytics queries

## Known Risks

### 1. Observation volume growth

Risk:

- `ListingObservation` can grow quickly because it records every matching scan hit

Mitigation:

- add indexes carefully
- keep date-range filters mandatory in heavy queries
- add rollups later if needed

### 2. SQLite percentile limitations

Risk:

- percentile calculations are not as ergonomic as in analytical databases

Mitigation:

- compute in application code for MVP if SQL becomes awkward
- only optimize later if query cost becomes a problem

### 3. Historical semantics

Risk:

- existing historical data before `ListingObservation` will be incomplete for true distribution analysis

Mitigation:

- treat new observation capture as the beginning of reliable BI history
- communicate that older data may be partial

## Production Data Note

Local repo data is not representative. Full data lives on the VPS.

For implementation planning, the next agent does not need a raw production DB dump immediately. If production validation is needed later, aggregate checks are sufficient first:

- observation counts by day
- listing counts by keyword
- notification counts by status
- scan-run volume and failure rate
- date-range coverage

## Definition of Done for the Epic

The epic is complete when:

- the bot records all scraped matching listings as historical observations
- a separate analytics web app exists in the monorepo
- the dashboard shows keyword-level price distributions and daily/weekly/monthly trends
- the dashboard supports listing drilldown and cheapest recent listings
- the system runs privately on the VPS using the existing SQLite-based stack

## Recommended Immediate Next Task

The next agent should start with a technical design / implementation PR for:

1. Prisma schema for `ListingObservation`
2. scanner ingestion changes
3. read-side query contract for the analytics endpoints

That is the minimum viable foundation. Without it, the dashboard will not have reliable business-intelligence data.
