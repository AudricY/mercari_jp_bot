# Mercari JP Bot — Agent Guide

## Quick Reference

| Task | Command |
|---|---|
| Install dependencies | `pnpm install` |
| Generate Prisma client | `pnpm run db:generate` |
| Run DB migrations (prod) | `pnpm run db:migrate` |
| Run DB migrations (dev) | `pnpm run db:migrate:dev -- --name <name>` |
| Import legacy config.yaml | `pnpm run db:import-legacy-config` |
| Seed config into DB | `pnpm run db:seed` |
| Build all packages | `pnpm run build` |
| Typecheck all packages | `pnpm run typecheck` |
| Run tests | `pnpm run test` |
| Dev mode (unified) | `pnpm --filter @mercari-bot/unified run dev` |
| Start (unified) | `pnpm --filter @mercari-bot/unified run start` |
| Docker Compose up | `docker compose up --build` |

## Project Overview

Mercari JP Bot monitors Mercari Japan listings by keyword, sending near-real-time Telegram alerts for new or price-dropped items. It is a TypeScript monorepo with a unified process that combines an HTTP API, a scheduler, a scraper, and a notification worker — backed by SQLite (via Prisma) and deployed on an Oracle Cloud VPS via Docker.

## Architecture

### Directory Layout

```
apps/unified/          — Single-process app: API + scheduler + scraper + notifier
packages/core/         — Shared library: config, logging, types, metrics, scraping, dedup
packages/db/           — Prisma client wrappers and keyword helpers
prisma/                — Schema + migrations (SQLite)
scripts/               — One-off tooling (legacy import, seed, OCI provisioning)
docs/                  — Architecture overview, VPS details
.github/workflows/     — CI (GitHub Actions)
```

### Tech Stack

- **Language:** TypeScript (ES2022, NodeNext modules, strict mode)
- **Runtime:** Node.js >= 20.11
- **Package manager:** pnpm 10 (workspace monorepo)
- **HTTP framework:** Fastify 5
- **Database:** SQLite via Prisma ORM
- **Scraping:** HTTP-based (DPoP auth, custom scraper in `packages/core`)
- **Notifications:** Telegram Bot API
- **Logging:** Pino (structured JSON)
- **Metrics:** prom-client (Prometheus)
- **Validation:** Zod
- **Testing:** Vitest (in `packages/core`)
- **Build:** `tsc` per package
- **CI:** GitHub Actions (typecheck → build → test)
- **Deploy:** Docker (single image) on Oracle Cloud VPS

### Key Services (within `apps/unified`)

| Module | Role |
|---|---|
| `api.ts` | Fastify server — health checks, metrics, keyword CRUD, admin endpoints |
| `scheduler.ts` | Periodic scan and daily-summary scheduling |
| `scanner.ts` | Mercari scraping, dedup, listing persistence |
| `notifier.ts` | Telegram message delivery with retry/backoff |
| `auth.ts` | Admin token + IP allowlist middleware |

### Data Model (Prisma/SQLite)

`keywords` → `listings` → `notifications`; plus `seen_listings` (dedup), `scan_runs` (audit), `daily_keyword_counts` (stats), `system_config` (runtime settings).

## Conventions

- **Always use pnpm.** Never use npm or yarn.
- **Always run `pnpm run db:generate`** after changing `prisma/schema.prisma`.
- **Always run `pnpm run typecheck`** before considering code complete.
- **Never commit `.env` files.** Use `.env.example` as the template.
- **Never commit the `data/` directory** — it contains SQLite databases.
- **Use ESM everywhere.** All packages have `"type": "module"`.
- **Use `workspace:*`** for inter-package dependencies.
- **Branch strategy:** `main` is the production branch. Feature branches merge into `main`.
- **Build before start:** The unified app runs from compiled `dist/` — always `pnpm run build` before `pnpm run start`.
- **Secrets come from environment only.** No hardcoded tokens or credentials.
- **Structured logging only.** Use the Pino logger from `@mercari-bot/core`, never `console.log`.

## Documentation

| Document | Location |
|---|---|
| Architecture overview | [`docs/overview.md`](./docs/overview.md) |
| Oracle VPS details | [`docs/oracle-vps.md`](./docs/oracle-vps.md) |
| Database schema | [`prisma/schema.prisma`](./prisma/schema.prisma) |
| Environment template | [`.env.example`](./.env.example) |
| CI pipeline | [`.github/workflows/ci.yml`](./.github/workflows/ci.yml) |
| Deployment workflow | [`docs/workflows/deploy.md`](./docs/workflows/deploy.md) |
| Database migrations | [`docs/workflows/database-migrations.md`](./docs/workflows/database-migrations.md) |

## Continuous Documentation

> **Always update docs as you work.** When you discover gotchas, workarounds, useful commands, error patterns, or non-obvious architecture context — write it down immediately. Don't let knowledge die in a conversation.
>
> - Small, broad notes → `AGENTS.md`
> - Workflow-specific → `docs/workflows/`
> - Package-specific → README within that package
