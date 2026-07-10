# syntax=docker/dockerfile:1
# openldr-api — the backend/API image (no SPA; the studio image serves the UI).
# ---- build: install, build the server, produce a standalone deploy ----
FROM node:22-bookworm-slim AS build
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm turbo build --filter @openldr/server
# pnpm deploy resolves the server's workspace deps into a self-contained dir (/deploy).
RUN pnpm --filter @openldr/server deploy --prod --legacy /deploy
# Bundled, license-safe terminology fixtures (FHIR R4 ValueSet catalog + full UCUM). @openldr/db
# resolves these at runtime relative to the server bundle (dist/../fixtures/fhir), but pnpm deploy
# carries only code, not packages/db's data dir — so stage them explicitly. Without this the
# first-boot seed logs "fixture missing" and coded form-fields come up with no terminology.
RUN mkdir -p /deploy/fixtures/fhir && cp packages/db/fixtures/fhir/*.gz /deploy/fixtures/fhir/

# ---- runtime: slim node, non-root, API-only (no SPA — WEB_DIST_DIR unset) ----
FROM node:22-bookworm-slim AS runtime
LABEL org.opencontainers.image.source="https://github.com/Open-Laboratory-Data-Repository/openldr"
ENV NODE_ENV=production
ENV PORT=3000
WORKDIR /app
COPY --from=build /deploy /app
# No WEB_DIST_DIR / no /app/web: app.ts guards SPA serving on existsSync(webDist), so with the
# default path absent the server runs API + /health only. The studio image owns the SPA.
RUN useradd --system --uid 10001 openldr && chown -R openldr /app
USER openldr
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=10 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]
