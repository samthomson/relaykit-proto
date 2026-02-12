# relaykit-proto

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
- Auth: Nostr (later - start without auth)
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

## Project Structure

```
relaykit-proto/
├── docker-compose.yml
├── Dockerfile.dev
├── start-dev.sh
├── README.md
└── app/
    ├── frontend/     (React + tRPC client)
    ├── backend/      (Node.js + tRPC server)
    └── presets/      (service docker-compose templates)
        └── stirfry-relay/
            ├── docker-compose.yml
            └── metadata.json
```

## Development vs Production

**Prerequisites (dev):** Docker. For local HTTPS: `brew install mkcert && mkcert -install`, then `./scripts/gen-dev-certs.sh` (creates certs + Caddyfile). Without mkcert/certs, Caddy will fail on 80/443.

**Dev:** Everything runs in Docker
- `docker compose up --build`
- Dokploy: http://localhost:3000
- RelayKit Frontend: http://localhost:5173
- RelayKit Backend: http://localhost:4000

**First-time setup:**
1. Create Dokploy account at http://localhost:3000 eg email@address.com/password
2. Generate API key at http://localhost:3000/dashboard/settings/profile
3. Paste API key in RelayKit at http://localhost:5173

**Local HTTPS (any domain you want):** The cert covers whatever hostnames you list in `scripts/dev-domains.txt` (e.g. relay.local, myrelay.test, reallyrelay.io). Flow when adding a new relay in local dev:

1. Add your chosen domain to `/etc/hosts` (e.g. `127.0.0.1 reallyrelay.io`).
2. Add that domain to `scripts/dev-domains.txt` (copy from `scripts/dev-domains.example.txt` if you don't have one).
3. Run `./scripts/gen-dev-certs.sh`. If compose is already running, restart it so Caddy picks up the new cert.
4. In RelayKit, create the relay and set its domain to that hostname; choose "No SSL" for local.

Then https://your-domain works in the browser and routes to the relay.

**Prod:** `docker compose -f docker-compose.prod.yml up -d`. No Caddy; Traefik on 80/443 with real certs. RelayKit: build frontend, backend serves static + tRPC, one port.


## Key Technical Details

**Dokploy Integration:**
- Backend calls Dokploy's REST API (need to find API docs)
- Dokploy runs on `http://dokploy:3000` (accessible via Docker network)

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

- [ ] does the ssl mode select on creation make sense?
- [ ] convey real deployment status in UI (not assumed success)
- [ ] tidy up creation process/code
- [ ] tidy ui, for how we present projects - and react client structure (componentize)
- [ ] change default project group for all projects to go into
- [ ] let user specify a project/group for projects to go into
- [ ] get it running the service properly
- [ ] dns record instructions for after adding a domain?
- [ ] expose volumes to user so they can manage (view/delete/optional: create service from volume)
- [ ] can more things be exposed from stirfry, like whitelist kinds and users (and default blacklist all). and then how to reload to get this config?
