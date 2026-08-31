#!/usr/bin/env bash
# Cut a relaykit release. Before running: edit app/version.json (bump version, set
# dokployVersion + notes). This script validates everything is consistent, regenerates
# app/release.yml, commits, tags vX.Y.Z, and pushes (tag + branch) — that push triggers
# CI to build and publish the stable channel.
#
# Usage:
#   ./scripts/release.sh            # full release: validate, commit, tag, push
#   ./scripts/release.sh --check    # validate only (also used by CI)
set -euo pipefail
cd "$(dirname "$0")/.."

CHECK_ONLY=false
[[ "${1:-}" == "--check" ]] && CHECK_ONLY=true

fail() { echo "ERROR: $*" >&2; exit 1; }

VERSION=$(jq -r .version app/version.json)
NOTES=$(jq -r .notes app/version.json)
DOKPLOY_VERSION=$(jq -r .dokployVersion app/version.json)
TAG="v${VERSION}"

[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+([-+][0-9A-Za-z.-]+)?$ ]] || fail "version.json version '$VERSION' is not semver"
[[ "$NOTES" != "" && "$NOTES" != "null" ]] || fail "version.json notes are empty"
[[ "$DOKPLOY_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "version.json dokployVersion '$DOKPLOY_VERSION' is not a bare dokploy semver"

COMPOSE_DOKPLOY=$(grep -oE 'dokploy/dokploy:v[0-9.]+' docker-compose.yml | head -1 | sed 's/.*:v//')
[[ "$COMPOSE_DOKPLOY" == "$DOKPLOY_VERSION" ]] || fail "dokploy pin mismatch: compose has v$COMPOSE_DOKPLOY, version.json says $DOKPLOY_VERSION"

# Tag must be new (and must not already exist on the remote).
REMOTE=$(git remote | grep -x origin || git remote | head -1)
[[ -n "$REMOTE" ]] || fail "no git remote configured"
if git ls-remote --exit-code --tags "$REMOTE" "refs/tags/$TAG" >/dev/null 2>&1; then
  fail "tag $TAG already exists on $REMOTE"
fi
# Keep CHANGELOG.md in sync: the release entry must be the newest one in the file.
DATE=$(date +%F)
CHANGELOG_ENTRY="## $VERSION — $DATE"
if ! head -3 CHANGELOG.md | grep -qF "$CHANGELOG_ENTRY"; then
  if $CHECK_ONLY; then
    fail "CHANGELOG.md has no entry for $VERSION ($CHANGELOG_ENTRY) — add it or run the full release"
  fi
  # Prepend the entry right after the "# changelog" heading.
  TMP=$(mktemp)
  printf '# changelog\n\n%s\n%s\n' "$CHANGELOG_ENTRY" "$NOTES" > "$TMP"
  tail -n +2 CHANGELOG.md >> "$TMP"
  mv "$TMP" CHANGELOG.md
  echo "prepended changelog entry: $CHANGELOG_ENTRY"
fi

# Regenerate the baked stack definition; require a clean diff afterwards.
./scripts/gen-release-yml.sh
if $CHECK_ONLY; then
  git diff --exit-code app/release.yml || fail "app/release.yml is out of date — run scripts/gen-release-yml.sh and commit"
  echo "check passed: $TAG ready (dokploy v$DOKPLOY_VERSION)"
  exit 0
fi

git add app/version.json app/release.yml CHANGELOG.md
if git diff --cached --quiet; then
  echo "nothing new to commit (version.json already committed); tagging current tree"
else
  git commit -m "release $TAG

$NOTES"
fi
git tag -a "$TAG" -m "relaykit $TAG

$NOTES"
git push "$REMOTE" HEAD --follow-tags
echo "released $TAG — CI will build and publish the stable channel"
