# Deployment

The bot runs as a single Docker container on an Oracle Cloud VPS (see [`docs/oracle-vps.md`](../oracle-vps.md) for instance details).

## Prerequisites

- SSH access to the VPS: `ssh ubuntu@161.118.204.72`
- Docker and Docker Compose installed on the VPS
- `.env` file configured on the VPS

## Steps

1. **Push to `main`** — CI runs typecheck, build, and tests via GitHub Actions.

2. **SSH into the VPS:**
   ```bash
   ssh ubuntu@161.118.204.72
   ```

3. **Pull latest code:**
   ```bash
   cd ~/mercari_jp_bot   # <!-- TODO: verify actual path on VPS -->
   git pull origin main
   ```

4. **Rebuild and restart:**
   ```bash
   docker compose up --build -d
   ```
   This runs migrations automatically (the `migrations` service runs `pnpm run db:migrate` before the app starts).

5. **Verify:**
   ```bash
   docker compose logs -f app
   # Check health endpoint
   curl http://localhost:3000/v1/health/live
   ```

## Rollback

```bash
git checkout <previous-commit>
docker compose up --build -d
```

## Notes

- The Docker image uses `node:22-slim` and installs pnpm globally.
- The `data/` volume is mounted from the host for SQLite persistence.
- The app listens on port 3000.
