import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { registerErrorHandler } from './error-handler';
import fastifyStatic from '@fastify/static';
import compress from '@fastify/compress';
import { appError } from '@openldr/core';
import type { AppContext } from '@openldr/bootstrap';
import { registerReportRoutes } from './reports-routes';
import { registerTerminologyRoutes } from './terminology-routes';
import { registerTerminologyAdminRoutes } from './terminology-admin-routes';
import { registerOntologyRoutes } from './ontology-routes';
import { registerDashboardRoutes } from './dashboards-routes';
import { registerAuditRoutes } from './audit-routes';
import { registerUsersRoutes } from './users-routes';
import { registerFormsRoutes } from './forms-routes';
import { registerReportDesignRoutes } from './report-designs-routes';
import { registerReportDefRoutes } from './report-defs-routes';
import { registerReportCategoryRoutes } from './report-categories-routes';
import { registerMarketplaceRoutes } from './marketplace-routes';
import { registerWorkflowRoutes } from './workflows-routes';
import { registerConnectorsRoutes } from './connectors-routes';
import { registerSettingsRoutes } from './settings-routes';
import { registerActivityRoutes } from './activity-routes';
import { registerPluginUiRoutes } from './plugin-ui-routes';
import { registerQueryRoutes } from './query-routes';
import { registerSyncRoutes } from './sync-routes';
import { createConnectorStore, createCustomQueryStore } from '@openldr/db';
import { registerAuth } from './auth-plugin';
import { readAppVersion } from './version';

export function registerConfigRoute(
  app: FastifyInstance<any, any, any, any>,
  ctx: {
    cfg: { TARGET_STORE_ADAPTER: string; AUTH_DEV_BYPASS: boolean; OIDC_ISSUER_URL: string; OIDC_WEB_CLIENT_ID: string; OIDC_AUDIENCE?: string };
    featureFlags: { get(id: string): Promise<boolean> };
  },
): void {
  const version = readAppVersion();
  app.get('/api/config', async () => ({
    dashboardSqlEnabled: await ctx.featureFlags.get('dashboard.raw_sql'),
    authEnforced: !ctx.cfg.AUTH_DEV_BYPASS,
    version,
    environment: process.env.NODE_ENV ?? 'development',
    oidc: {
      issuerUrl: ctx.cfg.OIDC_ISSUER_URL,
      clientId: ctx.cfg.OIDC_WEB_CLIENT_ID,
      audience: ctx.cfg.OIDC_AUDIENCE ?? null,
    },
  }));
}

/** Map the TRUST_PROXY env string to Fastify's `trustProxy` option. Unset/''/'false' → false (don't
 *  trust X-Forwarded-For; req.ip is the socket peer). A bare integer → that many proxy hops (the
 *  single gateway is '1'). 'true' → trust every hop. Anything else → a comma-separated list of trusted
 *  proxy IPs/subnets, passed through to proxy-addr. */
export function parseTrustProxy(v: string | undefined): boolean | number | string {
  const s = (v ?? '').trim();
  if (s === '' || s.toLowerCase() === 'false') return false;
  if (s.toLowerCase() === 'true') return true;
  if (/^\d+$/.test(s)) return Number(s);
  return s;
}

export async function buildApp(ctx: AppContext) {
  const app = Fastify({
    loggerInstance: ctx.logger,
    // Short 8-char correlation id per request; surfaces in every error body + one log line.
    genReqId: () => randomUUID().replace(/-/g, '').slice(0, 8),
    // When a reverse proxy (the gateway) fronts the app, trust its X-Forwarded-For so req.ip and the
    // auth.failed audit reflect the real client, not the proxy's container IP. Off by default (safe for
    // dev/direct); the installed stack sets TRUST_PROXY=1 (one gateway hop). See config TRUST_PROXY.
    trustProxy: parseTrustProxy(ctx.cfg.TRUST_PROXY),
  });
  registerErrorHandler(app);

  // Sync S7-B: compress the wire in both directions. Labs reconcile over bandwidth-constrained,
  // often asymmetric links, so this is the cheapest available win — it shrinks the big terminology
  // bulk pages / pull responses AND (via globalDecompression) accepts gzipped push bodies.
  // Content negotiation is transparent: a client that doesn't ask simply doesn't get compressed bytes,
  // so nothing existing breaks. `compressible`/mime-db skips already-compressed types (PDF/xlsx exports).
  //
  // This MUST be `await`ed here, before any route is added — which is why buildApp is async. The
  // plugin works by installing an `onRoute` listener that rewrites each route's hooks as it is
  // registered; a fire-and-forget `void app.register(...)` (the @fastify/static idiom below) defers
  // the plugin to ready(), by which point every route has already been added and the listener sees
  // NONE of them — leaving the plugin silently inert. @fastify/static is safe that way because it
  // registers its OWN routes; compress decorates pre-existing ones.
  await app.register(compress, {
    globalCompression: true,
    globalDecompression: true,
    threshold: 1024,
    encodings: ['gzip'],
    requestEncodings: ['gzip'],
    // v9 calls this as (encoding, request) and requires a real Error back. Returning an AppError
    // keeps the 415 inside the error-code catalog: registerErrorHandler's existing AppError branch
    // maps it to status 415 + code SY0415 + a correlationId, with no cross-cutting change to how
    // any other error is classified.
    onUnsupportedRequestEncoding: (encoding) =>
      appError('SY0415', { message: `unsupported content-encoding: ${encoding}` }),
  });

  // RFC 7694: advertise to clients that this server ACCEPTS gzipped request bodies. The sync push
  // client reads this off the response and only then starts gzipping its batches — an older central
  // never sends it, so an upgraded lab safely keeps pushing plain JSON. Truthful globally, since
  // globalDecompression accepts gzip on every route.
  app.addHook('onSend', async (_req, reply) => {
    if (!reply.getHeader('accept-encoding')) reply.header('Accept-Encoding', 'gzip');
  });

  app.get('/health', async (_req, reply) => {
    const result = await ctx.health.runAll();
    reply.code(result.status === 'down' ? 503 : 200);
    return result;
  });

  registerAuth(app, ctx);

  app.get('/api/me', async (req, reply) => {
    if (!req.user) {
      reply.code(401);
      return { error: 'authentication required' };
    }
    return req.user;
  });

  registerConfigRoute(app, ctx);
  registerReportRoutes(app, ctx);
  registerTerminologyRoutes(app, ctx);
  registerTerminologyAdminRoutes(app, ctx);
  registerOntologyRoutes(app, ctx);
  registerDashboardRoutes(app, ctx);
  registerAuditRoutes(app, ctx);
  registerUsersRoutes(app, ctx);
  registerFormsRoutes(app, ctx);
  registerReportDesignRoutes(app, ctx, {
    customQueries: createCustomQueryStore(ctx.internalDb),
    runConnectorSql: (input) => {
      const run = ctx.workflows.services.runConnectorSql;
      if (!run) throw new Error('connector SQL runner unavailable');
      return run(input);
    },
  });
  registerReportDefRoutes(app, ctx);
  registerReportCategoryRoutes(app, ctx);
  registerMarketplaceRoutes(app, ctx);
  registerPluginUiRoutes(app, ctx);
  registerConnectorsRoutes(app, ctx, { connectors: createConnectorStore(ctx.internalDb) });
  registerWorkflowRoutes(app, ctx, { connectors: createConnectorStore(ctx.internalDb) });
  registerQueryRoutes(app, ctx, {
    customQueries: createCustomQueryStore(ctx.internalDb),
    connectors: {
      list: () => ctx.connectors.list(),
      get: (id) => ctx.connectors.get(id),
    },
    datasets: {
      // WorkflowDatasetStore keys datasets by name and does not expose a separate id; use name as id.
      list: async () => (await ctx.workflows.datasets.list()).map((d) => ({
        id: d.name, name: d.name, rowCount: d.rowCount, publishedTable: d.publishedTable,
      })),
      // getByName returns WorkflowDataset | undefined; map absent → null for the route contract.
      getByName: async (name) => (await ctx.workflows.datasets.getByName(name)) ?? null,
    },
    runConnectorSql: (input) => {
      // Optional on WorkflowServices, but always wired in bootstrap for the server context.
      const run = ctx.workflows.services.runConnectorSql;
      if (!run) throw new Error('connector SQL runner unavailable');
      return run(input);
    },
  });
  registerSettingsRoutes(app, ctx);
  registerActivityRoutes(app, ctx);
  registerSyncRoutes(app, ctx);

  // Serve the built SPA under /studio/* — the landing site owns /.
  // API + health routes are registered above and always win.
  // WEB_DIST_DIR overrides the location for container deploys (the SPA may not sit at
  // ../../studio/dist relative to the bundled server entry); defaults to the workspace layout.
  const webDist = process.env.WEB_DIST_DIR ?? resolve(dirname(fileURLToPath(import.meta.url)), '../../studio/dist');
  if (existsSync(webDist)) {
    void app.register(fastifyStatic, { root: webDist, prefix: '/studio/' });
    app.setNotFoundHandler((req, reply) => {
      const url = req.raw.url ?? '';
      if (url.startsWith('/api')) {
        void reply.code(404).send({ error: 'not found' });
        return;
      }
      if (url.startsWith('/studio')) {
        // SPA client-side route: serve the shell from webDist/index.html
        void reply.sendFile('index.html');
        return;
      }
      // Everything else (e.g. /) is owned by the landing container
      void reply.code(404).send({ error: 'not found' });
    });
  }

  return app;
}
