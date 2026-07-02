# syntax=docker/dockerfile:1
# openldr-studio — the studio SPA as a static nginx site served under /studio/.
# ---- build the SPA (@openldr/studio, base '/studio/') ----
FROM node:22-bookworm-slim AS build
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm turbo build --filter @openldr/studio

# ---- serve the static site ----
FROM nginx:1.27-alpine AS runtime
COPY --from=build /repo/apps/studio/dist /usr/share/nginx/html/studio
COPY apps/studio/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
