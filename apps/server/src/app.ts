import Fastify from 'fastify';
import type { AppContext } from '@openldr/bootstrap';

// Return type is inferred: passing our pino logger as `loggerInstance` makes
// Fastify specialize its logger generic to pino's `Logger`, which is narrower
// than the default `FastifyBaseLogger` — so we must not force that annotation.
export function buildApp(ctx: AppContext) {
  const app = Fastify({ loggerInstance: ctx.logger });

  app.get('/health', async (_req, reply) => {
    const result = await ctx.health.runAll();
    reply.code(result.status === 'down' ? 503 : 200);
    return result;
  });

  return app;
}
