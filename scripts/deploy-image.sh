#!/usr/bin/env bash
# Deploy prebuilt GHCR image: pull latest (or tag) and restart relaykit-prod.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
if [[ -f "$REPO_ROOT/.env" ]]; then
  set -a
  source "$REPO_ROOT/.env"
  set +a
fi

DEPLOY_HOST="${DEPLOY_HOST:-}"
DEPLOY_PATH="${DEPLOY_PATH:-}"
IMAGE_TAG="${IMAGE_TAG:-latest}"
IMAGE_NAME="${IMAGE_NAME:-ghcr.io/samthomson/relaykit}"
FULL_IMAGE="${IMAGE_NAME}:${IMAGE_TAG}"

if [[ -z "$DEPLOY_HOST" ]]; then
  echo "Error: DEPLOY_HOST is not set."
  echo "  export DEPLOY_HOST=your-server"
  exit 1
fi

if [[ -z "$DEPLOY_PATH" ]]; then
  echo "Error: DEPLOY_PATH is not set (path to repo on remote server)."
  echo "  export DEPLOY_PATH=/root/relaykit"
  exit 1
fi

echo "=============================================="
echo "  RelayKit image deploy → $DEPLOY_HOST:$DEPLOY_PATH"
echo "  Image: $FULL_IMAGE"
echo "=============================================="
echo ""

run_remote() {
  ssh "$DEPLOY_HOST" "cd \"$DEPLOY_PATH\" && $1"
}

echo "==> Syncing deploy config from git..."
run_remote "git pull --ff-only"
echo ""

echo "==> Pulling image and recreating relaykit-prod..."
run_remote "RELAYKIT_IMAGE=\"$FULL_IMAGE\" docker compose --profile prod pull relaykit-prod && RELAYKIT_IMAGE=\"$FULL_IMAGE\" docker compose --profile prod up -d --no-deps relaykit-prod"
echo ""

echo "==> Building and starting hello-world..."
run_remote "docker compose --profile prod up -d --build --no-deps hello-world"
echo ""

echo "==> Refreshing Traefik routing state..."
run_remote "docker compose --profile prod restart dokploy-traefik-prod"
echo ""

echo "=============================================="
echo "  Done."
echo "=============================================="
