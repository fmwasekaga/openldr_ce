import Fastify from 'fastify';
import type { AppContext } from '@openldr/bootstrap';
import { registerReportRoutes } from './reports-routes';

export function buildApp(ctx: AppContext) {
  const app = Fastify({ loggerInstance: ctx.logger });

  app.get('/health', async (_req, reply) => {
    const result = await ctx.health.runAll();
    reply.code(result.status === 'down' ? 503 : 200);
    return result;
  });

  registerReportRoutes(app, ctx);

  return app;
}
