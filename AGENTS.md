# Mercari JP Bot - Agent Notes

Minimal routing for agents. Prefer source files and docs over duplicating
details here.

## How to work

- Always plan changes before making
- Docs must be kept up to date

## Start Here

- Scripts and tool versions: `package.json`
- Main app: `apps/unified/src/`
- Shared code: `packages/core/`, `packages/db/`
- Schema/migrations: `prisma/`
- Keyword config: `config.yaml`
- Market-collection categories: `catalog/market-categories.yaml`
- eBay collection queries: `catalog/ebay-queries.yaml`

## Hard Rules

- Use `pnpm` only.
- Agents should commit completed, verified work without waiting to be asked (small, logical commits). Pushing still requires an explicit request.
- Keep secrets in env only. Do not commit `.env` or `data/`.
- Run `pnpm run typecheck` before finishing code changes.
- Run `pnpm run db:generate` after Prisma schema changes.
- Send all Mercari search/detail calls through `MercariRequestScheduler`; scheduler concurrency alone does not protect against API 429s.
- Use `searchMercari` in `packages/core` for any new Mercari search need (probes included); do not hand-roll request bodies.
- Same for eBay: all Browse API calls go through `EbayRequestScheduler` using `EbayClient` from `packages/core`.

## Route Details

- DB and migrations: `docs/workflows/database.md`
- Deploy and keyword reload: `docs/workflows/deploy.md`
- Mercari rate-limit probing: `docs/workflows/mercari-rate-limit-probe.md`
- Mercari API capabilities / what to scrape: `docs/mercari-scrape-intelligence.md`
- Market collection (categories, sold prices): `docs/workflows/market-collection.md`
- eBay collection (Browse API, queries): `docs/workflows/ebay-collection.md`
- VPS access and firewall: `docs/oracle-vps.md`
- Switch keyword/search behavior: `docs/switch-software-keywords.md`
- Analytics context: `docs/analytics-bi-epic.md`
