# syntax=docker/dockerfile:1
# ---- build: install, build web + server, produce a standalone server deploy ----
FROM node:22-bookworm-slim AS build
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm turbo build --filter @openldr/studio --filter @openldr/server
# pnpm deploy resolves the server's workspace deps into a self-contained dir (/deploy).
RUN pnpm --filter @openldr/server deploy --prod --legacy /deploy
# Stage the built SPA where WEB_DIST_DIR points — decoupled from the server-dist layout.
RUN mkdir -p /deploy/web && cp -r apps/studio/dist/. /deploy/web/
# Bundled, license-safe terminology fixtures (FHIR R4 ValueSet catalog + full UCUM). @openldr/db
# resolves these at runtime relative to the server bundle (dist/../fixtures/fhir), but pnpm deploy
# carries only code, not packages/db's data dir — so stage them explicitly. Without this the
# first-boot seed logs "fixture missing" and coded form-fields come up with no terminology.
RUN mkdir -p /deploy/fixtures/fhir && cp packages/db/fixtures/fhir/*.gz /deploy/fixtures/fhir/

# ---- runtime: slim node, non-root, single-origin (SPA + API + auth) ----
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV PORT=3000
ENV WEB_DIST_DIR=/app/web
WORKDIR /app
COPY --from=build /deploy /app
# /app/dist/index.js = the server entry (pnpm deploy copies the package root, build → dist/).
# /app/node_modules = resolved prod deps. /app/web = the SPA (WEB_DIST_DIR).
RUN useradd --system --uid 10001 openldr && chown -R openldr /app
USER openldr
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=10 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]
