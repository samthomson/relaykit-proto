#!/usr/bin/env bash
# Deploy from local machine: SSH to server, git pull, build images, then recreate containers.
# Build runs while old containers are still up, so downtime is only the brief recreate.
#
# One-time setup:
#   1. Copy .env.example to .env and set DEPLOY_HOST, DEPLOY_PATH.
#   2. Ensure you can SSH to the server (e.g. ssh "$DEPLOY_HOST").
#
# Usage:
#   ./scripts/deploy.sh           # pull, build, then up (default)
#   ./scripts/deploy.sh --no-rebuild   # pull + restart only (no new image; rarely needed)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
if [[ -f "$REPO_ROOT/.env" ]]; then
  set -a
  source "$REPO_ROOT/.env"
  set +a
fi

DEPLOY_HOST="${DEPLOY_HOST:-}"
DEPLOY_PATH="${DEPLOY_PATH:-}"

REBUILD=true
for arg in "$@"; do
  case "$arg" in
    --no-rebuild|-n) REBUILD=false ;;
  esac
done

if [[ -z "$DEPLOY_HOST" ]]; then
  echo "Error: DEPLOY_HOST is not set."
  echo "  export DEPLOY_HOST=your-server   # or use an SSH alias from ~/.ssh/config"
  echo "  export DEPLOY_PATH=/path/to/relaykit   # path on the remote server"
  exit 1
fi

if [[ -z "$DEPLOY_PATH" ]]; then
  echo "Error: DEPLOY_PATH is not set (path to repo on remote server)."
  echo "  export DEPLOY_PATH=/root/relaykit   # example"
  exit 1
fi

echo "=============================================="
echo "  RelayKit deploy → $DEPLOY_HOST:$DEPLOY_PATH"
echo "  Mode: $([ "$REBUILD" = true ] && echo 'pull + build + up' || echo 'pull + restart only')"
echo "=============================================="
echo ""

run_remote() {
  ssh "$DEPLOY_HOST" "cd $DEPLOY_PATH && $1"
}

if [[ "$REBUILD" == true ]]; then
  echo "==> Pulling latest code..."
  run_remote "git pull"
  echo ""

  echo "==> Building images (existing containers still running)..."
  run_remote "docker compose --profile prod build"
  echo ""

  echo "==> Recreating containers (short downtime)..."
  run_remote "docker compose --profile prod up -d"
  echo ""

  echo "==> Refreshing Traefik routing state..."
  run_remote "docker compose --profile prod restart dokploy-traefik-prod"
else
  echo "==> Pulling latest code..."
  run_remote "git pull"
  echo ""

  echo "==> Restarting containers (no rebuild)..."
  run_remote "docker compose --profile prod restart"
fi

echo ""
echo "=============================================="
echo "  Done."
echo "=============================================="
