# syntax=docker/dockerfile:1
# ---- build the landing SPA (@openldr/web) ----
FROM node:22-bookworm-slim AS build
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm turbo build --filter @openldr/web

# ---- serve the static site ----
FROM nginx:1.27-alpine AS runtime
LABEL org.opencontainers.image.source="https://github.com/Open-Laboratory-Data-Repository/openldr"
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
# Landing is a static SPA served at container root; the outer gateway proxies '/' here.
EXPOSE 80
