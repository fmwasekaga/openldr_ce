import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '@openldr/bootstrap';
import { CustomQueryInputSchema } from '@openldr/dashboards';
import type { CustomQueryStore } from '@openldr/db';
import { requireRole } from './rbac';

const AUTHOR_ROLES = ['lab_admin', 'lab_manager', 'data_analyst'];

export interface QueryRouteDeps {
  customQueries: CustomQueryStore;
  connectors: {
    list(): Promise<{ id: string; name: string; type: string | null; enabled: boolean }[]>;
    get(id: string): Promise<{ id: string; name: string; type: string | null; enabled: boolean } | null>;
  };
  datasets: {
    list(): Promise<{ id: string; name: string; rowCount: number; publishedTable?: string | null }[]>;
    getByName(name: string): Promise<{ name: string; columns: unknown; rows: unknown[]; publishedTable?: string | null } | null>;
  };
  runConnectorSql(input: { connectorId: string; sql: string }): Promise<{ columns: { key: string; label: string }[]; rows: Record<string, unknown>[] }>;
}

export function registerQueryRoutes(app: FastifyInstance, _ctx: AppContext, deps: QueryRouteDeps): void {
  const GUARD = { preHandler: requireRole(...AUTHOR_ROLES) };

  // ---- Custom Query CRUD ----
  app.get('/api/custom-queries', GUARD, async () => deps.customQueries.list());

  app.get('/api/custom-queries/:id', GUARD, async (req, reply) => {
    const { id } = req.params as { id: string };
    const q = await deps.customQueries.get(id);
    if (!q) { reply.code(404); return { error: 'not found' }; }
    return q;
  });

  app.post('/api/custom-queries', GUARD, async (req, reply) => {
    const parsed = CustomQueryInputSchema.safeParse(req.body);
    if (!parsed.success) { reply.code(400); return { error: parsed.error.message }; }
    // The DB unique(name) constraint is the real guard; this pre-check is a best-effort
    // friendly error (TOCTOU: a concurrent create could still win the race).
    if (await deps.customQueries.getByName(parsed.data.name)) { reply.code(409); return { error: 'name already exists' }; }
    const id = `cq_${randomUUID().slice(0, 8)}`;
    await deps.customQueries.create({ id, ...parsed.data });
    return { id };
  });

  app.put('/api/custom-queries/:id', GUARD, async (req, reply) => {
    const { id } = req.params as { id: string };
    const existing = await deps.customQueries.get(id);
    if (!existing) { reply.code(404); return { error: 'not found' }; }
    const parsed = CustomQueryInputSchema.partial().safeParse(req.body);
    if (!parsed.success) { reply.code(400); return { error: parsed.error.message }; }
    if (parsed.data.name && parsed.data.name !== existing.name) {
      const clash = await deps.customQueries.getByName(parsed.data.name);
      if (clash && clash.id !== id) { reply.code(409); return { error: 'name already exists' }; }
    }
    await deps.customQueries.update(id, parsed.data);
    return { ok: true };
  });

  app.delete('/api/custom-queries/:id', GUARD, async (req) => {
    const { id } = req.params as { id: string };
    await deps.customQueries.remove(id);
    return { ok: true };
  });
}
