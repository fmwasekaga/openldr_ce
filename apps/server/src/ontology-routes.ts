import type { FastifyInstance, FastifyReply } from 'fastify';
import type { AppContext } from '@openldr/bootstrap';
import { redact } from '@openldr/core';
import { recordAudit } from './audit-helper';

export function registerOntologyRoutes(app: FastifyInstance<any, any, any, any>, ctx: AppContext): void {
  const ontology = ctx.terminology.ontology;
  type IdParam = { id: string };
  const queryParam = (req: { query: unknown }, key: string) => (req.query as Record<string, string | undefined>)[key];

  app.get('/api/terminology/ontology/distributions', async () => ontology.listDistributions());
  app.get('/api/terminology/ontology/distributions/:id', async (req) => ontology.getDistribution((req.params as IdParam).id));
  app.delete('/api/terminology/ontology/distributions/:id', async (req, reply) => {
    const id = (req.params as IdParam).id;
    try {
      const before = await ontology.getDistribution(id).catch(() => null);
      await ontology.unlink(id);
      await recordAudit(ctx, req, { action: 'ontology_distribution.delete', entityType: 'ontology_distribution', entityId: id, before, after: null });
      reply.code(204);
      return null;
    } catch (err) {
      reply.code(500);
      return { error: redact(err instanceof Error ? err.message : String(err)) };
    }
  });

  app.get('/api/terminology/ontology/:id/roots', async (req) => ontology.roots((req.params as IdParam).id));
  app.get('/api/terminology/ontology/:id/children', async (req) =>
    ontology.children((req.params as IdParam).id, queryParam(req, 'parent') ?? '__ROOT__'),
  );
  app.get('/api/terminology/ontology/:id/node', async (req) =>
    ontology.node((req.params as IdParam).id, queryParam(req, 'code') ?? ''),
  );
  app.get('/api/terminology/ontology/:id/search', async (req) =>
    ontology.search((req.params as IdParam).id, queryParam(req, 'q') ?? ''),
  );
  app.get('/api/terminology/ontology/:id/path', async (req) =>
    ontology.path((req.params as IdParam).id, queryParam(req, 'code') ?? ''),
  );
  app.get('/api/terminology/ontology/:id/panels', async (req) =>
    ontology.panelMembers((req.params as IdParam).id, queryParam(req, 'loinc') ?? ''),
  );
  app.get('/api/terminology/ontology/:id/answers', async (req) =>
    ontology.answerOptions((req.params as IdParam).id, queryParam(req, 'loinc') ?? ''),
  );
  app.get('/api/terminology/ontology/:id/specimens', async (req) =>
    ontology.specimenCodes((req.params as IdParam).id, queryParam(req, 'loinc') ?? ''),
  );

  async function sse(
    req: { params: unknown; query: unknown },
    reply: FastifyReply,
    run: (id: string, path: string | undefined, onProgress: (progress: unknown) => void) => Promise<void>,
  ): Promise<void> {
    const id = (req.params as IdParam).id;
    const path = (req.query as Record<string, string | undefined>).path;
    reply.hijack();
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    const write = (event: string, data: unknown) => reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    try {
      await run(id, path, (progress) => write('progress', progress));
      write('done', await ontology.getDistribution(id));
    } catch (err) {
      write('error', { message: redact(err instanceof Error ? err.message : String(err)) });
    } finally {
      reply.raw.end();
    }
  }

  app.get('/api/terminology/ontology/:id/build', async (req, reply) =>
    sse(req, reply, (id, path, onProgress) => {
      if (!path) throw new Error('A server-side distribution path is required.');
      return ontology.build(id, path, onProgress as never);
    }),
  );
  app.get('/api/terminology/ontology/:id/rebuild', async (req, reply) =>
    sse(req, reply, (id, _path, onProgress) => ontology.rebuild(id, onProgress as never)),
  );
}
