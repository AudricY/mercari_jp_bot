# Deployment

Docker Compose on Oracle Cloud VPS. Two services from one image: `migrations` (runs once) then `app` (long-running).

## Deploy

1. Push to `main` — CI runs typecheck, build, tests.
2. SSH and deploy:
   ```bash
   ssh ubuntu@161.118.204.72
   cd ~/mercari_jp_bot
   git pull origin main
   docker compose up --build -d
   ```
3. Verify:
   ```bash
   docker compose ps
   curl http://localhost:3000/v1/health/live
   docker compose logs -f app --tail 30
   ```

## Rollback

```bash
git checkout <previous-commit>
docker compose up --build -d
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
