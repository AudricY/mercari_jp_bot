# Deployment

The bot runs via Docker Compose on an Oracle Cloud VPS (see [`docs/oracle-vps.md`](../oracle-vps.md) for instance details). Two services share a single image: `migrations` (runs once) and `app` (long-running).

## Prerequisites

- SSH access to the VPS: `ssh ubuntu@161.118.204.72`
- Docker and Docker Compose installed on the VPS
- `.env` file at `~/mercari_jp_bot/.env` (see `.env.example` for template)

## Deploy

1. **Push to `main`** — CI runs typecheck, build, and tests via GitHub Actions.

2. **SSH into the VPS and deploy:**
   ```bash
   ssh ubuntu@161.118.204.72
   cd ~/mercari_jp_bot
   git pull origin main
   docker compose up --build -d
   ```
   This rebuilds the image, runs migrations (`prisma migrate deploy`), then starts the app.

3. **Verify:**
   ```bash
   docker compose ps                         # Both services healthy
   curl http://localhost:3000/v1/health/live  # {"status":"ok",...}
   curl http://localhost:3000/v1/health/ready # {"status":"ready"}
   docker compose logs -f app --tail 30      # Scheduler ticking, no errors
   ```

## Rollback

```bash
cd ~/mercari_jp_bot
git checkout <previous-commit>
docker compose up --build -d
```

## Useful Commands

```bash
# View app logs
docker compose logs -f app --tail 50

# View migration logs
docker compose logs migrations

# Restart without rebuilding
docker compose restart app

# Full teardown
docker compose down
```

## Notes

- The Docker image uses `node:22-slim` with `openssl` installed (required by Prisma).
- `DATABASE_URL` is overridden in `docker-compose.yml` to an absolute path (`file:/app/data/mercari.db`) because Prisma resolves relative `file:` URLs from the schema directory, not the working directory.
- The `data/` volume is mounted from the host (`./data:/app/data`) for SQLite persistence.
- `config.yaml` is mounted read-only (`./config.yaml:/app/config.yaml:ro`). The `CONFIG_PATH` env var points to it.
- The app listens on port 3000 (mapped to host).
- To hot-reload keyword config without restarting: edit `config.yaml` on the host, then `curl -X POST -H "Authorization: Bearer $TOKEN" http://localhost:3000/v1/config/reload`.
