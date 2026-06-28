# Database Workflow

SQLite is accessed through Prisma. The schema lives in `prisma/schema.prisma`
and migrations live in `prisma/migrations/`.

## Schema Changes

1. Edit `prisma/schema.prisma`
2. Run `pnpm run db:migrate:dev -- --name <name>`
3. Run `pnpm run db:generate`
4. Run `pnpm run typecheck && pnpm run build`
5. Commit the new migration

Production runs migrations through Docker Compose with `prisma migrate deploy`.

## Notes

- Prisma `file:` URLs resolve relative to `prisma/schema.prisma`; Docker uses
  `file:/app/data/mercari.db`.
- SQLite files do not shrink after large drops until `VACUUM`; stop the app
  first.
- `listings` is the current-state store. Daily market history is snapshot-based
  in `daily_keyword_market_stats` and `daily_item_market_stats`.
