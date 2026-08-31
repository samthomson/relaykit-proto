FROM node:20-alpine AS builder

WORKDIR /build

# Install all workspace deps in a single pass (workspace-aware).
COPY app/package.json app/yarn.lock ./
COPY app/frontend/package.json ./frontend/
COPY app/backend/package.json ./backend/
COPY app/shared/package.json ./shared/
COPY app/shared/ui/package.json ./shared/ui/
COPY app/apps/relay-explorer/package.json ./apps/relay-explorer/
COPY app/apps/blossom-explorer/package.json ./apps/blossom-explorer/
COPY app/apps/nsite-explorer/package.json ./apps/nsite-explorer/
COPY app/apps/grasp-explorer/package.json ./apps/grasp-explorer/
COPY app/apps/hello-world/package.json ./apps/hello-world/
COPY app/apps/notif-hub/package.json ./apps/notif-hub/
RUN yarn install --frozen-lockfile --network-timeout 600000

# Copy sources and build frontend + each embedded app.
COPY app/frontend ./frontend
COPY app/shared ./shared
COPY app/apps ./apps
RUN cd frontend && yarn build
RUN yarn workspace app-relay-explorer build
RUN yarn workspace app-blossom-explorer build
RUN yarn workspace app-nsite-explorer build
RUN yarn workspace app-grasp-explorer build

FROM node:20-alpine

# Playwright/Chromium are required in prod for setup automation.
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont

ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium-browser

WORKDIR /app

# Install workspace runtime deps (root + backend; frontend + embedded apps are prebuilt static).
COPY app/package.json app/yarn.lock ./
COPY app/frontend/package.json ./frontend/
COPY app/backend/package.json ./backend/
COPY app/shared/package.json ./shared/
COPY app/shared/ui/package.json ./shared/ui/
COPY app/apps/relay-explorer/package.json ./apps/relay-explorer/
COPY app/apps/blossom-explorer/package.json ./apps/blossom-explorer/
COPY app/apps/nsite-explorer/package.json ./apps/nsite-explorer/
COPY app/apps/grasp-explorer/package.json ./apps/grasp-explorer/
COPY app/apps/hello-world/package.json ./apps/hello-world/
COPY app/apps/notif-hub/package.json ./apps/notif-hub/
RUN yarn install --production --frozen-lockfile --network-timeout 600000

# Install tsx globally for backend runtime command.
RUN yarn global add tsx

# Copy only runtime sources and built frontend.
COPY app/version.json ./version.json
COPY app/release.yml ./release.yml
COPY app/CHANGELOG.md ./CHANGELOG.md
COPY app/backend ./backend
COPY app/presets ./presets
COPY app/shared ./shared
COPY --from=builder /build/frontend/dist ./frontend/dist

# Mount each embedded app's built dist under frontend/dist/apps/<id>/.
COPY --from=builder /build/apps/relay-explorer/dist ./frontend/dist/apps/relay-explorer
COPY --from=builder /build/apps/blossom-explorer/dist ./frontend/dist/apps/blossom-explorer
COPY --from=builder /build/apps/nsite-explorer/dist ./frontend/dist/apps/nsite-explorer
COPY --from=builder /build/apps/grasp-explorer/dist ./frontend/dist/apps/grasp-explorer

# Copy scripts
COPY scripts/automate-dokploy-setup.js /app/scripts/
COPY scripts/docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

EXPOSE 4000 5173 5174 5175 5176 5178

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["yarn", "dev"]
