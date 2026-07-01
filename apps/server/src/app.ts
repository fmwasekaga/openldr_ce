import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import type { AppContext } from '@openldr/bootstrap';
import { registerReportRoutes } from './reports-routes';
import { registerTerminologyRoutes } from './terminology-routes';
import { registerTerminologyAdminRoutes } from './terminology-admin-routes';
import { registerOntologyRoutes } from './ontology-routes';
import { registerDashboardRoutes } from './dashboards-routes';
import { registerAuditRoutes } from './audit-routes';
import { registerUsersRoutes } from './users-routes';
import { registerFormsRoutes } from './forms-routes';
import { registerMarketplaceRoutes } from './marketplace-routes';
import { registerWorkflowRoutes } from './workflows-routes';
import { registerConnectorsRoutes } from './connectors-routes';
import { registerPluginUiRoutes } from './plugin-ui-routes';
import { createConnectorStore } from '@openldr/db';
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
    dashboardSqlEnabled: (await ctx.featureFlags.get('dashboard.raw_sql')) && ctx.cfg.TARGET_STORE_ADAPTER === 'pg',
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
  const app = Fastify({ loggerInstance: ctx.logger });

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
  registerMarketplaceRoutes(app, ctx);
  registerPluginUiRoutes(app, ctx);
  registerConnectorsRoutes(app, ctx, { connectors: createConnectorStore(ctx.internalDb) });
  registerWorkflowRoutes(app, ctx, { connectors: createConnectorStore(ctx.internalDb) });

  // Serve the built SPA if present. API + health are registered first and win.
  // WEB_DIST_DIR overrides the location for container deploys (the SPA may not sit at
  // ../../studio/dist relative to the bundled server entry); defaults to the workspace layout.
  const webDist = process.env.WEB_DIST_DIR ?? resolve(dirname(fileURLToPath(import.meta.url)), '../../studio/dist');
  if (existsSync(webDist)) {
    void app.register(fastifyStatic, { root: webDist });
    app.setNotFoundHandler((req, reply) => {
      if (req.raw.url && req.raw.url.startsWith('/api')) {
        void reply.code(404).send({ error: 'not found' });
        return;
      }
      void reply.sendFile('index.html');
    });
  }

  return app;
}
