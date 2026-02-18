# Mercari JP Bot — Agent Guide

## Commands

| Task | Command |
|---|---|
| Install deps | `pnpm install` |
| Generate Prisma client | `pnpm run db:generate` |
| Migrate DB (dev) | `pnpm run db:migrate:dev -- --name <name>` |
| Migrate DB (prod) | `pnpm run db:migrate` |
| Build | `pnpm run build` |
| Typecheck | `pnpm run typecheck` |
| Test | `pnpm run test` |
| Dev mode | `pnpm --filter @mercari-bot/unified run dev` |
| Start | `pnpm --filter @mercari-bot/unified run start` |
| Docker up | `docker compose up --build` |
| Reload keywords | `curl -X POST -H "Authorization: Bearer $TOKEN" http://localhost:3000/v1/config/reload` |

## What This Is

TypeScript monorepo: monitors Mercari Japan by keyword, sends Telegram alerts for new/cheaper items. Single Node.js process (API + scheduler + scraper + notifier), SQLite via Prisma, deployed via Docker on Oracle Cloud VPS.

## Layout

```
apps/unified/          — Single-process app: API + scheduler + scraper + notifier
packages/core/         — Config, logging, types, metrics, scraping, dedup
packages/db/           — Prisma client wrappers, keyword helpers
prisma/                — Schema + migrations (SQLite)
config.yaml            — Keyword definitions (source of truth, synced to DB on startup/reload)
```

### Key Modules (`apps/unified/src/`)

| File | Role |
|---|---|
| `api.ts` | Fastify server — health, metrics, keywords, config reload, admin |
| `scheduler.ts` | Periodic scan + daily summary scheduling |
| `scanner.ts` | Mercari scraping, dedup, listing persistence |
| `notifier.ts` | Telegram delivery with retry/backoff |
| `auth.ts` | Admin token + IP allowlist middleware |
| `sync.ts` | Syncs `config.yaml` → DB keywords |

### Data Model

`keywords` → `listings` → `notifications`; plus `seen_listings` (dedup), `scan_runs` (audit), `daily_keyword_counts` (stats).

## Stack

TypeScript (ESM, strict) · Node 20+ · pnpm 10 · Fastify 5 · Prisma/SQLite · Pino · Zod · Vitest · Docker

## Conventions

- **pnpm only.** No npm/yarn.
- **ESM everywhere.** `"type": "module"`, `workspace:*` for internal deps.
- **`db:generate` after schema changes.** Prisma client is generated code.
- **`typecheck` before done.** Always verify.
- **Build before start.** App runs from `dist/`.
- **Structured logging.** Pino via `@mercari-bot/core`, never `console.log`.
- **Env-only secrets.** No hardcoded tokens. Never commit `.env` or `data/`.
- **Branch strategy.** `main` is production. Feature branches merge into `main`.

## DB Migration Workflow

1. Edit `prisma/schema.prisma`
2. `pnpm run db:migrate:dev -- --name <name>`
3. `pnpm run db:generate`
4. `pnpm run build && pnpm run typecheck`
5. Commit migration files in `prisma/migrations/`

Production migrations run automatically via Docker Compose (`prisma migrate deploy`).

## Gotchas

- **Prisma `file:` paths** resolve relative to `prisma/schema.prisma`, not cwd. Docker overrides to absolute `file:/app/data/mercari.db`.
- **`node:22-slim` needs OpenSSL** — Dockerfile installs it for Prisma.
- **`pnpm --filter` sets cwd** to the package dir (`apps/unified/`), not repo root. Use `CONFIG_PATH` env var.

## Ops Docs

- Deployment workflow: [`docs/workflows/deploy.md`](./docs/workflows/deploy.md)
- VPS details: [`docs/oracle-vps.md`](./docs/oracle-vps.md)

## Continuous Documentation

When you discover gotchas or non-obvious context, write it down:
- Broad notes → this file
- Workflow-specific → `docs/workflows/`
- Package-specific → README in that package
