# Mercari JP Bot (Node/TypeScript Rewrite)

This repository has been fully rewritten from Python to a production-oriented Node.js/TypeScript stack.

## Stack
- TypeScript + Fastify (`apps/api`)
- Playwright scraper worker (`apps/worker-scrape`)
- BullMQ + Redis queues (`scan-keyword`, `notify-item`, `send-daily-summary`, `retry-failed-notification`)
- Postgres + Prisma (`prisma/schema.prisma`, `packages/db`)
- Notification worker for Telegram (`apps/worker-notify`)
- Scheduler service (`apps/scheduler`)
- Structured logs + Prometheus metrics

## Repository Layout
- `apps/api`: health/readiness/metrics + admin API
- `apps/scheduler`: periodic scan and daily summary enqueueing
- `apps/worker-scrape`: Mercari scraping + dedupe + notification enqueue
- `apps/worker-notify`: Telegram delivery + daily summary + retry handling
- `packages/core`: shared contracts/config/queue helpers/logging/metrics
- `packages/db`: Prisma client wrappers and keyword mapping helpers
- `prisma/schema.prisma`: canonical database schema
- `scripts/import-legacy-config.ts`: imports legacy `config.yaml` into DB

## Environment
Copy `.env.example` to `.env` and set values.

Required values:
- `DATABASE_URL`
- `REDIS_URL`
- `ADMIN_TOKEN`
- `ADMIN_ALLOWED_IPS`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`

## Local Development
```bash
pnpm install
pnpm run db:generate
pnpm run db:migrate:dev -- --name init
pnpm run db:import-legacy-config
```

Run services in separate terminals:
```bash
pnpm --filter @mercari-bot/api run dev
pnpm --filter @mercari-bot/scheduler run dev
pnpm --filter @mercari-bot/worker-scrape run dev
pnpm --filter @mercari-bot/worker-notify run dev
```

## Docker Compose
```bash
docker compose up --build
```

Services:
- `postgres`
- `redis`
- `migrations`
- `api`
- `scheduler`
- `worker-scrape`
- `worker-notify`

## API Endpoints
- `GET /v1/health/live`
- `GET /v1/health/ready`
- `GET /v1/metrics`
- `GET /v1/keywords`
- `POST /v1/keywords`
- `PATCH /v1/keywords/:id`
- `DELETE /v1/keywords/:id`
- `POST /v1/keywords/:id/scan`
- `GET /v1/jobs/:id`
- `GET /v1/runs/recent`
- `GET /v1/stats/daily`
- `POST /v1/config/reload`

Admin endpoints require:
- Bearer token: `Authorization: Bearer <ADMIN_TOKEN>`
- Client IP in `ADMIN_ALLOWED_IPS`

## Legacy Data Migration
The rewrite intentionally does not import `seen_items.json` history. Only keyword/schedule config is imported:
```bash
pnpm run db:import-legacy-config
```

`config.yaml` remains supported strictly as a one-time import source.

## Notes
- Telegram token redaction is applied in logs.
- Telegram `4xx/5xx` failures no longer terminate service processes.
- Photo failures use text-message fallback.
