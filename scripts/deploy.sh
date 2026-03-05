#!/usr/bin/env bash
set -euo pipefail

IMAGE="ghcr.io/audricy/mercari-jp-bot"
TAG="${1:-latest}"
VPS="ubuntu@161.118.204.72"
VPS_DIR="~/mercari_jp_bot"

echo "==> Building image..."
docker build -t "$IMAGE:$TAG" -t "$IMAGE:latest" .

echo "==> Pushing to GHCR..."
docker push "$IMAGE:$TAG"
docker push "$IMAGE:latest"

echo "==> Deploying on VPS..."
ssh "$VPS" "cd $VPS_DIR && git pull && docker compose pull && docker compose down && docker compose up -d"

echo "==> Done! Checking health in 10s..."
sleep 10
ssh "$VPS" "curl -sf http://localhost:3000/v1/health/live && echo ' OK' || echo ' FAILED'"
