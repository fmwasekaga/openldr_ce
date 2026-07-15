import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { registerErrorHandler } from './error-handler';
import fastifyStatic from '@fastify/static';
import compress from '@fastify/compress';
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

export function buildApp(ctx: AppContext) {
  const app = Fastify({
    loggerInstance: ctx.logger,
    // Short 8-char correlation id per request; surfaces in every error body + one log line.
    genReqId: () => randomUUID().replace(/-/g, '').slice(0, 8),
  });
  registerErrorHandler(app);

  // Sync S7-B: compress the wire in both directions. Labs reconcile over bandwidth-constrained,
  // often asymmetric links, so this is the cheapest available win — it shrinks the big terminology
  // bulk pages / pull responses AND (via globalDecompression) accepts gzipped push bodies.
  // Content negotiation is transparent: a client that doesn't ask simply doesn't get compressed bytes,
  // so nothing existing breaks. `compressible`/mime-db skips already-compressed types (PDF/xlsx exports).
  void app.register(compress, {
    globalCompression: true,
    globalDecompression: true,
    threshold: 1024,
    encodings: ['gzip'],
    requestEncodings: ['gzip'],
    // @fastify/compress v9 calls this as (encoding, request); it must return an actual Error (not
    // a plain object) — TS enforces this. The statusCode/code pair is honoured verbatim by
    // registerErrorHandler's toErrorResponse (see error-handler.ts), so this genuinely reaches the
    // client as 415, not the generic SY0500 fallback a plain unclassified Error would get.
    onUnsupportedRequestEncoding: (encoding) => {
      const err = new Error(`unsupported content-encoding: ${encoding}`) as Error & { statusCode: number; code: string };
      err.statusCode = 415;
      err.code = 'UNSUPPORTED_MEDIA_TYPE';
      return err;
    },
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
