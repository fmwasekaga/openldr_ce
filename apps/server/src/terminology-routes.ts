import type { FastifyInstance, FastifyReply } from 'fastify';
import type { AppContext } from '@openldr/bootstrap';
import { TerminologyError } from '@openldr/terminology';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function registerTerminologyRoutes(app: FastifyInstance<any, any, any, any>, ctx: AppContext): void {
  const ops = ctx.terminology.ops;

  app.get('/api/terminology/CodeSystem/$lookup', async (req, reply) => {
    const { system, code } = req.query as { system?: string; code?: string };
    if (!system || !code) { reply.code(400); return { error: 'system and code required' }; }
    const r = await ops.lookup(system, code);
    if (!r.found) { reply.code(404); return { error: `not found: ${system}|${code}` }; }
    return { resourceType: 'Parameters', parameter: [{ name: 'display', valueString: r.display }, { name: 'system', valueUri: system }, { name: 'code', valueCode: code }] };
  });

  app.get('/api/terminology/ValueSet/$validate-code', async (req, reply) => {
    const { url, system, code } = req.query as { url?: string; system?: string; code?: string };
    if (!code || (!url && !system)) { reply.code(400); return { error: 'code and (url or system) required' }; }
    try {
      const r = url ? await ops.validateCode({ valueSetUrl: url, code }) : await ops.validateCode({ system: system!, code });
      return { resourceType: 'Parameters', parameter: [{ name: 'result', valueBoolean: r.result }, { name: 'message', valueString: r.message }] };
    } catch (err) { return mapErr(err, reply); }
  });

  app.get('/api/terminology/ValueSet/$expand', async (req, reply) => {
    const { url, filter, count, offset } = req.query as { url?: string; filter?: string; count?: string; offset?: string };
    if (!url) { reply.code(400); return { error: 'url required' }; }
    try {
      return await ops.expand(url, { filter, count: count ? Number(count) : undefined, offset: offset ? Number(offset) : undefined });
    } catch (err) { return mapErr(err, reply); }
  });

  app.get('/api/terminology/ConceptMap/$translate', async (req, reply) => {
    const { url, system, code } = req.query as { url?: string; system?: string; code?: string };
    if (!system || !code) { reply.code(400); return { error: 'system and code required' }; }
    const r = await ops.translate({ mapUrl: url, system, code });
    return { resourceType: 'Parameters', parameter: [{ name: 'result', valueBoolean: r.result }, ...r.matches.map((m) => ({ name: 'match', valueCoding: { system: m.targetSystem, code: m.targetCode } }))] };
  });
}

function mapErr(err: unknown, reply: FastifyReply) {
  if (err instanceof TerminologyError) {
    reply.code(err.kind === 'not-found' ? 404 : 400);
    return { resourceType: 'OperationOutcome', issue: [{ severity: 'error', code: err.kind === 'not-found' ? 'not-found' : 'invalid', diagnostics: err.message }] };
  }
  const msg = err instanceof Error ? err.message : String(err);
  reply.code(/ECONNREFUSED|connect/i.test(msg) ? 503 : 500);
  return { resourceType: 'OperationOutcome', issue: [{ severity: 'error', code: 'exception', diagnostics: msg }] };
}
