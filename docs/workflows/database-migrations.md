# Database Migrations

This project uses **Prisma Migrate** with a **SQLite** database.

## Schema Location

`prisma/schema.prisma` — this is the single source of truth for the data model.

## Development Workflow

1. **Edit the schema:**
   ```bash
   $EDITOR prisma/schema.prisma
   ```

2. **Create a migration:**
   ```bash
   pnpm run db:migrate:dev -- --name <descriptive-name>
   ```
   This generates a SQL migration file in `prisma/migrations/` and applies it to your local DB.

3. **Regenerate the Prisma client:**
   ```bash
   pnpm run db:generate
   ```

4. **Rebuild packages that depend on `@mercari-bot/db`:**
   ```bash
   pnpm run build
   ```

5. **Run typecheck to verify everything compiles:**
   ```bash
   pnpm run typecheck
   ```

## Production Deployment

Production migrations run automatically via Docker Compose — the `migrations` service executes:

```bash
pnpm run db:migrate
```

This runs `prisma migrate deploy`, which applies any pending migrations without creating new ones.

## Seeding

To seed keyword config from `config.yaml` into the database:

```bash
pnpm run db:import-legacy-config
```

Or use the seed script:

```bash
pnpm run db:seed
```

## Gotchas

- Always run `pnpm run db:generate` after schema changes — the Prisma client is generated code and won't update automatically.
- The SQLite database file lives in `data/` — this directory is gitignored and volume-mounted in Docker.
- Migration files in `prisma/migrations/` **must** be committed to git.
