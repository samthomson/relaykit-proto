# changelog

## 0.3.2 — 2026-09-04
routing health tooling: ghost router detection + dns check on the debug page, invalid hostnames rejected at deploy/save, tls retry behind a reconnect modal (no more dashboard hang)

## 0.3.1 — 2026-09-04
fix: services could silently lose ssl (traefik default cert, never healed on redeploy). domain rows now reconcile with configured hosts on every deploy, config save and domain edit

## 0.3.0 — 2026-09-01
insights: warn/critical results now show a top-level banner; changelog fixes

## 0.2.5 — 2026-08-31
fix self-update: bake release.yml into the image (0.2.4's update failed on a missing file)

## 0.2.4 — 2026-08-31
in-app changelog

## 0.2.3 — 2026-08-31
hello-world: ui fix when reusing a post with images

## 0.2.2 — 2026-08-31
hello-world: image previews keep aspect ratio (uniform height, natural width)

## 0.2.1 — 2026-08-31
fix services list with dokploy 0.30; rubix loader while updating

## 0.2.0 — 2026-08-30
handle degraded services & smoother updates

## 0.1.1 — 2026-08-30
refreshed update dialog: release notes, status badges
