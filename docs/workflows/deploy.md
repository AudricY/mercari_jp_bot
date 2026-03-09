# Deployment

Docker Compose on Oracle Cloud VPS. Three services from one image: `migrations` (runs once), `app` (long-running), and `analytics` (private web UI on port `3001`).

Images are built locally and pushed to GHCR (`ghcr.io/audricy/mercari-jp-bot`). The VPS only pulls — no building on the 1GB RAM machine.

## Deploy

1. Build and push locally:
   ```bash
   docker build -t ghcr.io/audricy/mercari-jp-bot:latest .
   docker push ghcr.io/audricy/mercari-jp-bot:latest
   ```
2. Push code and pull on VPS:
   ```bash
   git push origin main
   ssh ubuntu@161.118.204.72 'cd ~/mercari_jp_bot && git pull && docker compose pull && docker compose down && docker compose up -d'
   ```
3. Verify:
   ```bash
   ssh ubuntu@161.118.204.72 'curl -sf http://localhost:3000/v1/health/live'
   ssh ubuntu@161.118.204.72 'docker compose -f ~/mercari_jp_bot/docker-compose.yml logs -f app --tail 30'
   ssh ubuntu@161.118.204.72 'docker compose -f ~/mercari_jp_bot/docker-compose.yml logs -f analytics --tail 30'
   ```

If a deploy includes the migration that drops `listing_observations`, reclaim disk afterwards during a maintenance window:
```bash
ssh ubuntu@161.118.204.72 'cd ~/mercari_jp_bot && docker compose stop app analytics && sqlite3 data/mercari.db "VACUUM;" && docker compose up -d'
```

## Analytics Auth

The analytics web app uses its own login credentials and signed session cookie. Set these in `.env` before deploying:

```bash
ANALYTICS_AUTH_USER=analytics
ANALYTICS_AUTH_PASSWORD=<strong-password>
ANALYTICS_SESSION_PASSWORD=<32+ character random secret>
```

The analytics app should stay private even with app-level auth. Prefer keeping port `3001` restricted at the firewall or reverse proxy layer.

## Rollback

```bash
# Re-tag a previous image and push, or rebuild from old commit:
git checkout <previous-commit>
docker build -t ghcr.io/audricy/mercari-jp-bot:latest .
docker push ghcr.io/audricy/mercari-jp-bot:latest
ssh ubuntu@161.118.204.72 'cd ~/mercari_jp_bot && docker compose pull && docker compose down && docker compose up -d'
```

## Useful Commands

```bash
docker compose logs -f app --tail 50   # App logs
docker compose logs migrations          # Migration logs
docker compose restart app              # Restart without rebuild
docker compose down                     # Full teardown
```

## Hot-Reload Keywords

Edit `config.yaml` on host, then:
```bash
curl -X POST -H "Authorization: Bearer $TOKEN" http://localhost:3000/v1/config/reload
```
