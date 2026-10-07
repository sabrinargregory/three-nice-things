#!/usr/bin/env bash
# Update cycle: pull latest code and images, run migrations, restart services.
set -euo pipefail
cd "$(dirname "$0")"

git pull --ff-only
docker compose --profile tools pull
docker compose --profile tools run --rm migrate
docker compose up -d --remove-orphans
docker image prune -f
