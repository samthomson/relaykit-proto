<p align="center">
  <img src="assets/relaykit-logo.png" alt="relaykit logo" width="168" />
</p>

# relaykit

## What It Is

A simple UI for deploying Nostr services (relays, blossom servers, etc.) using Dokploy under the hood.

User deploys RelayKit once, then uses it to spin up Nostr services without touching Dokploy directly.

## Architecture

```
Browser → RelayKit App → Dokploy API
```

**Stack:**
- Frontend: Vite + React + tRPC client
- Backend: Node.js + TypeScript + tRPC server (serves frontend in prod)
- Communication: tRPC
- Auth: Nostr (NIP-07 browser extension, owner-only access)
- Presets: Docker-compose templates in `/presets/` directory
- State: PostgreSQL if needed (or just query Dokploy API)

**docker-compose.yml runs:**
- Dokploy + its Postgres/Redis
- dokploy-traefik (in prod: listens on 80 and 443, routes to services; in dev: no ports, Caddy in front)
- Caddy (dev only: listens on 80 and 443, terminates HTTPS with mkcert, forwards HTTP to Traefik)
- RelayKit app (one container: backend serves frontend)

## How It Works

1. Backend reads preset docker-compose templates from `/presets/{service}/`
2. User clicks "add service", selects service type, provides config (domain, etc.)
3. Backend calls Dokploy REST API to create and deploy the service
4. Dokploy handles actual container orchestration
5. User sees their deployed services and can manage them

## Available services

| Service         | Repo | Notes |
|-----------------|------|-------|
| nostr-rs-relay  | [scsibug/nostr-rs-relay](https://github.com/scsibug/nostr-rs-relay) | |
| nogringo/nostr-relay | [nogringo/nostr-relay](https://github.com/nogringo/nostr-relay) | NIP-17/59 relay with NIP-42 auth-gated gift-wrap reads (`kind:1059`). |
| Strfry          | [hoytech/strfry](https://github.com/hoytech/strfry) | |
| Blossom         | [hzrd149/blossom](https://github.com/hzrd149/blossom) | |
| nPanel          | [hzrd149/nsite-gateway](https://github.com/hzrd149/nsite-gateway) | Static sites on Nostr (NIP-5A) plus same-domain NIP-05 responses. Deploys nsite-gateway, a NIP-05 JSON sidecar, and a Caddy sidecar that serves `/.well-known/nostr.json` while rewriting `Host` for gateway traffic. Republished sites are picked up automatically within ~10 min (gateway re-polls relays); use the service's "refresh nsite content" action to apply immediately. Caddy caches content-hashed assets immutably and serves HTML with `no-cache` so new versions appear without stale-cache issues. |

## Project Structure

```
relaykit/
├── docker-compose.yml
├── Dockerfile.dev
├── start-dev.sh
├── README.md
└── app/
    ├── frontend/     (React + tRPC client)
    ├── backend/      (Node.js + tRPC server)
    ├── shared/       (shared TypeScript utils, e.g. nsite.ts)
    └── presets/      (service docker-compose templates)
        ├── strfry-relay/
        ├── nostr-rs-relay/
        ├── nogringo-nostr-relay/
        ├── blossom/
        └── npanel/
            ├── docker-compose.yml
            └── metadata.json
```

## Development vs Production

**Prerequisites (dev):** Docker. For local HTTPS: `brew install mkcert && mkcert -install`, then `./scripts/gen-dev-certs.sh` (creates certs + Caddyfile). Without mkcert/certs, Caddy will fail on 80/443.

**Dev:** Everything runs in Docker
- `docker compose --profile dev up --build`
- Dokploy: http://localhost:3020
- RelayKit Frontend: http://localhost:5173
- RelayKit Backend: http://localhost:4000

**Quick Start**

Run these commands from the project directory (the folder containing `docker-compose.yml`):

1. **Set JWT_SECRET**  
   Copy the example env file and set a secret:
   ```bash
   cp .env.example .env
   ```
   Edit `.env` and set `JWT_SECRET` to a random string (e.g. run `openssl rand -base64 32` and paste the result).

2. **Create external Dokploy network (one-time)**
   ```bash
   docker network create dokploy-network
   ```
   If it already exists, Docker will tell you and you can continue.

3. **Start the stack**  
   In the same project directory:
   `docker compose --profile dev up`
   
   Wait until the containers are up (Dokploy at http://localhost:3020, RelayKit at http://localhost:5173).

4. **Run the setup script**  
   Still in the project directory. Replace `npub1your...` with your real Nostr public key (the same one you’ll use to log in):
   ```bash
   OWNER_NPUB=npub1your... ADMIN_PASSWORD=your_secure_password ./scripts/setup-relaykit-auth.sh
   ```
   This creates a Dokploy admin account, gets an API key, and writes it to the RelayKit container. After it succeeds, reload RelayKit in your browser (default `http://localhost:5173`) and sign in with your Nostr extension (Alby, nos2x, etc.).

5. **If step 4 fails** (e.g. “Registration failed” because Dokploy already has an admin): log in to Dokploy, go to Settings → Profile → API/CLI, create an API key, then in the project directory run (paste your key in place of `PASTE_THE_KEY_HERE`):
   ```bash
   docker compose exec relaykit sh -c 'printf "%s" "PASTE_THE_KEY_HERE" > /app/.relaykit/bootstrap-key'
   ```

**Local HTTPS (any domain you want):** The cert covers whatever hostnames you list in `scripts/dev-domains.txt` (e.g. relay.local, myrelay.test, reallyrelay.io). Flow when adding a new relay in local dev:

1. Add your chosen domain to `/etc/hosts` (e.g. `127.0.0.1 reallyrelay.io`).
2. Add that domain to `scripts/dev-domains.txt` (copy from `scripts/dev-domains.example.txt` if you don't have one).
3. Run `./scripts/gen-dev-certs.sh`. If compose is already running, restart it so Caddy picks up the new cert.
4. In RelayKit, create the relay and set its domain to that hostname; choose "No SSL" for local.

Then https://your-domain works in the browser and routes to the relay.

**Prod install (on your own server):** point your domain's A record at the server, then from the repo root run:

```bash
./scripts/install.sh
```

It prompts for your owner npub and instance domain, auto-generates `JWT_SECRET` + admin password, writes `.env`, starts the prod stack, and provisions auth. Traefik issues a Let's Encrypt cert for `RELAYKIT_HOST` automatically (needs ports 80/443 open and the DNS record pointing at the server — not proxied through Cloudflare during first issuance).

**Change the domain or owner npub later:** just re-run `./scripts/install.sh` (it offers current values as defaults) — it updates `.env`, redeploys so Traefik re-issues the cert for the new domain, and syncs the owner npub. Manual equivalents: edit `RELAYKIT_HOST` in `.env` then `docker compose --profile prod up -d`; and for the owner, `docker compose exec relaykit-prod sh -c 'printf npub1... > /app/.relaykit/owner-npub'`.

Cert resolver is assumed to be `letsencrypt` (Dokploy's default in `/etc/dokploy/traefik/traefik.yml`); change the `certresolver` label in `docker-compose.yml` if yours differs.

**Prod (manual):** `docker compose --profile prod up -d`. No Caddy; Traefik on 80/443 with real certs. RelayKit: build frontend, backend serves static + tRPC, one port.

## Deploy

Set `DEPLOY_HOST` (e.g. `root@1.2.3.4` or an SSH alias) and `DEPLOY_PATH` (repo path on server) in `.env`.

- Legacy source-build deploy on server: `./scripts/deploy.sh`
- Image-based deploy (recommended): `./scripts/deploy-image.sh`

Image-based flow:
1. GitHub Actions builds and pushes `ghcr.io/<owner>/relaykit` on pushes to `master`.
2. Server pulls the image and recreates only `relaykit-prod`.

Optional overrides for image deploy:
- `IMAGE_TAG=<sha-or-tag> ./scripts/deploy-image.sh`
- `IMAGE_NAME=ghcr.io/<owner>/relaykit ./scripts/deploy-image.sh`

If GHCR package is private, run `docker login ghcr.io` on the server first (PAT with `read:packages`).

## Updating RelayKit

Releases are versioned images. `app/version.json` is the single source of truth: `version` (relaykit semver), `dokployVersion` (the dokploy pin this release ships), `notes` (shown in the update dialog). Each image also bakes in `app/release.yml` — the prod-only stack definition — and CI stamps the version/notes as image labels on GHCR.

**Releasing (maintainer):** bump `app/version.json` (and the dokploy/traefik pins if adopting a new dokploy), commit, push a git tag matching the version (`v1.4.3`). CI builds and pushes `ghcr.io/<owner>/relaykit:v1.4.3` + `:latest` with the version label.

**Updating (owner, in the dashboard):** the navbar shows the running version and a green "update" badge when GHCR's `latest` label reports a higher semver (checked anonymously via the OCI registry API — no auth server needed). Clicking update pulls the new image, stages its bundled `release.yml` onto the shared data volume, and starts a one-shot `docker:cli` helper container (over the docker socket) that runs `docker compose up -d --pull always` for the whole stack. The control plane (relaykit + dokploy) restarts for a few seconds; Traefik and all hosted services keep running throughout. The dashboard shows an "updating" overlay and reconnects automatically.

Version bump semantics are your call per release: semver reflects user-visible impact; a release that only adopts a newer dokploy is typically a patch.

## Key Technical Details

**Dokploy Integration:**
- Backend calls Dokploy's REST API (need to find API docs)
- Dokploy runs on `http://dokploy:3000` (accessible via Docker network)

## Branding Assets

- Header wordmark uses `Ethnocentric-Regular.otf` in `app/frontend/src/assets/fonts/`.
- Source archive was provided as `~/Desktop/ethnocentric.zip`.
- License reference is included at `app/frontend/src/assets/fonts/Typodermic Desktop EULA 2023.pdf`.

RelayKit has two domain flows: **create a service (with domain in one go)** and **change a service's domain later**.

| RelayKit action | Dokploy APIs (in order) |
|-----------------|-------------------------|
| **List services** | `project.all`; then for each project → each environment → each compose in that environment, we build one list entry. |
| **Create service** (domain set at creation) | `project.all` or `project.create` → `compose.create` → `compose.update` → `domain.create` → `compose.deploy` |
| **Change domain** (edit existing service) | `domain.delete` → `domain.create` → `compose.redeploy` |

**Presets:**
- Each service has a folder in `/app/presets/`
- `docker-compose.yml` = standard Docker Compose file using `${ENV_VAR}` syntax
- `metadata.json` = service info (name, description, required config fields)
- Backend collects config from user and passes as env vars to Dokploy's API
- Users can update env vars later without redeploying
- For routing: metadata must include `serviceName` (compose service name) and `internalPort`. Certificate type ("No SSL" for local, "Let's Encrypt" for prod) is chosen in the deploy modal and can be edited per service in the UI; editing a domain triggers redeploy.
- For unique data per instance: use `{{DEPLOY_SUFFIX}}` in volume names in the compose file; the backend replaces it at deploy time so each deployment gets its own volumes.

**State:**

- Option 1: Store deployment metadata in our own Postgres
- Option 2: Just query Dokploy API for deployed services (simpler)
- Decision: Start with option 2, add Postgres only if needed

## todo

issues:

next:
- [ ] standardise shared ui components (@relaykit/ui RelayPillsInput) across relay-explorer + hello-world
- [ ] ngrasp / ngit
- [ ] multilogin / group login (ie diff npubs/teams)
- [ ] cloudflare domain app
- [ ] notifs

- [ ] convey real deployment status in UI (not assumed success) - especially as it starts up, to know when it's "ready"
   - [ ] inc adding a new service, doesn't appear immediately in the ui
   - [ ] restart ui option. 
   - [ ] loader while service comes online, until started (and healthy?)
   - [ ] failed deploys show as "running" (eg dokploy compose build fails → no container, but card is green; insights/logs just error with "container is not running")
- [ ] what happens if I try to create a project with a domain already in use on another project?
- [ ] improve blossom app
- [ ] negentropy app
- [x] updates (in-dashboard self-update; see "Updating RelayKit")

maybe later:
- [ ] expose volumes to user so they can manage (view/delete/optional: create service from volume)
- [ ] publicly exposed relayexplorer?

unsorted:
- [ ] super smooth setup/install
- [ ] updates
- [ ] backup/export data?
- [ ] documentation: how to; every feature, one video, text description, pictures.

