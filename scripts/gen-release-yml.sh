#!/usr/bin/env bash
# Regenerate app/release.yml (the prod-only stack definition baked into relaykit images)
# from docker-compose.yml. Run by scripts/release.sh; CI verifies no drift.
#
# Transforms: drop dev-profile services and their node_modules volumes, the project
# `name`, the implicit default network, and per-volume `name`s (those would bake this
# checkout's project prefix and orphan data volumes on servers deployed under another
# project name). Dev services are listed explicitly; under `--profile prod` they'd be
# inert anyway.
set -euo pipefail
cd "$(dirname "$0")/.."

{
  printf '# GENERATED from docker-compose.yml by scripts/gen-release-yml.sh — do not edit by hand.\n'
  printf '# Prod-only stack definition baked into the relaykit image; applied by the in-UI self-update\n'
  printf '# (docker compose -p <project> -f release.yml --profile prod up -d --pull always).\n'
  COMPOSE_PROFILES=prod docker compose -f docker-compose.yml config --no-interpolate \
    | docker run --rm -i mikefarah/yq:4 eval 'del(.name, .networks.default, .services.caddy, .services.relaykit-dev, .services.dokploy-traefik-dev, .volumes.dev_nm_root, .volumes.dev_nm_frontend, .volumes.dev_nm_backend, .volumes.dev_nm_relay_explorer, .volumes.dev_nm_blossom_explorer, .volumes.dev_nm_nsite_explorer, .volumes.dev_nm_grasp_explorer, .volumes.dev_nm_hello_world, .volumes.dev_nm_notif_hub, .volumes.[].name)' -
} > app/release.yml

echo "wrote app/release.yml"
