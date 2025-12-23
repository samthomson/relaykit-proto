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
- RelayKit app (one container: backend serves frontend)
- RelayKit Postgres (if we need state)

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

**Dev:** Everything runs in Docker
- `docker-compose up --build`
- Dokploy: http://localhost:3000
- RelayKit Frontend: http://localhost:5173
- RelayKit Backend: http://localhost:4000

**First-time setup:**
1. Create Dokploy account at http://localhost:3000
2. Generate API key at http://localhost:3000/dashboard/settings/profile
3. Paste API key in RelayKit at http://localhost:5173

**Prod:** One container, backend serves built frontend
- Build frontend → static files
- Backend serves static files + tRPC API endpoints
- One port exposed (e.g., 4000)

## Key Technical Details

**Dokploy Integration:**
- Backend calls Dokploy's REST API (need to find API docs)
- Dokploy runs on `http://dokploy:3000` (accessible via Docker network)
- We deploy by POSTing docker-compose configs to Dokploy

**Presets:**
- Each service has a folder in `/app/presets/`
- `docker-compose.yml` = actual service configuration
- `metadata.json` = service info (name, description, required config fields)
- Backend does template substitution (domain, env vars) before deploying

**State:**
- Option 1: Store deployment metadata in our own Postgres
- Option 2: Just query Dokploy API for deployed services (simpler)
- Decision: Start with option 2, add Postgres only if needed


## todo

- [ ] tidy up creation process/code
- [ ] tidy ui, for how we present projects
- [ ] change default project group for all projects to go into
- [ ] let user specify a project/group for projects to go into
- [ ] get it running the service properly