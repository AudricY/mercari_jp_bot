# Mercari JP Bot - Agent Notes

Minimal routing for agents. Prefer source files and docs over duplicating
details here.

## Start Here

- Scripts and tool versions: `package.json`
- Main app: `apps/unified/src/`
- Shared code: `packages/core/`, `packages/db/`
- Schema/migrations: `prisma/`
- Keyword config: `config.yaml`

## Hard Rules

- Use `pnpm` only.
- Keep secrets in env only. Do not commit `.env` or `data/`.
- Run `pnpm run typecheck` before finishing code changes.
- Run `pnpm run db:generate` after Prisma schema changes.

## Route Details

- DB and migrations: `docs/workflows/database.md`
- Deploy and keyword reload: `docs/workflows/deploy.md`
- VPS access and firewall: `docs/oracle-vps.md`
- Switch keyword/search behavior: `docs/switch-software-keywords.md`
- Analytics context: `docs/analytics-bi-epic.md`
