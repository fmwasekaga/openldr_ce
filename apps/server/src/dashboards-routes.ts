import type { FastifyInstance, FastifyReply } from 'fastify';
import { ZodError } from 'zod';
import { DashboardQueryError, type AppContext } from '@openldr/bootstrap';
import { DashboardSchema, WidgetQuerySchema, type Dashboard } from '@openldr/dashboards';
import { recordAudit } from './audit-helper';
import { requireCapability } from './rbac';

// Reads and query execution require dashboards.view; authoring (create/update/delete of shared
// operational dashboards) is split by verb into dashboards.create/edit/delete. Raw-SQL widget
// authoring is gated further by the `dashboard.raw_sql` feature flag (see
// assertSqlAuthoringAllowed), and dashboard query execution itself is SELECT-only/read-only in
// @openldr/dashboards.
const VIEW = { preHandler: requireCapability('dashboards.view') };
const CREATE = { preHandler: requireCapability('dashboards.create') };
const EDIT = { preHandler: requireCapability('dashboards.edit') };
const DELETE = { preHandler: requireCapability('dashboards.delete') };

// Collect the set of already-vetted SQL templates (trimmed) from a persisted dashboard. On
// UPDATE these are the SQL widgets the user is allowed to keep — layout/chart/config edits to
// them must save even with the flag off; only NEW or CHANGED SQL is authoring and gated.
function persistedSqlTemplates(prev: Dashboard | undefined): Set<string> {
  const set = new Set<string>();
  if (!prev) return set;
  for (const w of prev.widgets) {
    if (w.query.mode === 'sql' && typeof w.query.sql === 'string') set.add(w.query.sql.trim());
  }
  return set;
}

// Authoring gate: when the `dashboard.raw_sql` feature flag is off, reject persisting a dashboard whose
// widgets introduce NEW or CHANGED `mode:'sql'` queries. This stops an untrusted user (the
// dashboard routes have no role gating) from storing arbitrary SQL and then executing it as
// "vetted" SQL. Non-SQL edits — and edits to non-SQL fields of an already-persisted SQL widget
// (chart type, layout, config) — are allowed: only the SQL text itself is gated.
//
// `prevTemplates` is the set of SQL templates already persisted (empty on CREATE, so any
// sql-mode widget is new and rejected). On UPDATE, an incoming sql widget whose (trimmed) SQL
// exact-matches a persisted template is unchanged/vetted and passes; a new or edited template
// does not match and is rejected. The server-seeded sample is inserted via the store directly,
// bypassing this route.
function assertSqlAuthoringAllowed(sqlEnabled: boolean, d: Dashboard, prevTemplates: Set<string>): void {
  if (sqlEnabled) return;
  for (const w of d.widgets) {
    if (w.query.mode === 'sql') {
      const sql = typeof w.query.sql === 'string' ? w.query.sql.trim() : '';
      if (!prevTemplates.has(sql)) {
        throw new DashboardQueryError('raw SQL widgets are disabled');
      }
    }
  }
}

export function registerDashboardRoutes(app: FastifyInstance<any, any, any, any>, ctx: AppContext): void {
  app.get('/api/dashboards/models', VIEW, async () => ctx.dashboards.models());

  // Global admin-governed universe of joinable tables (not per-model), for the join-picker UI.
  app.get('/api/dashboards/joinable-tables', VIEW, async () => ctx.dashboards.joinableTables());

  app.post('/api/dashboards/query', VIEW, async (req, reply) => {
    try {
      const q = WidgetQuerySchema.parse(req.body);
      return await ctx.dashboards.query(q);
    } catch (err) { return mapError(err, reply); }
  });

  // Builder→SQL eject: compile a builder-mode query to readable SQL text (parameters inlined as
  // literals) for the widget editor's SQL tab. Display-only — never executed as submitted here.
  app.post('/api/dashboards/compile-sql', VIEW, async (req, reply) => {
    try {
      const q = WidgetQuerySchema.parse(req.body);
      if (q.mode !== 'builder') { reply.code(400); return { error: 'compile-sql accepts a builder-mode query' }; }
      const sql = await ctx.dashboards.compileSql(q);
      return { sql };
    } catch (err) { return mapError(err, reply); }
  });

  app.get('/api/dashboards', VIEW, async () => ctx.dashboards.store.list());

  app.get('/api/dashboards/:id', VIEW, async (req, reply) => {
    const { id } = req.params as { id: string };
    const d = await ctx.dashboards.store.get(id);
    if (!d) { reply.code(404); return { error: `unknown dashboard: ${id}` }; }
    return d;
  });

  app.post('/api/dashboards', CREATE, async (req, reply) => {
    try {
      const parsed = DashboardSchema.parse(req.body);
      // CREATE: no prior dashboard, so no SQL is vetted — any sql-mode widget is new and gated.
      const sqlEnabled = await ctx.featureFlags.get('dashboard.raw_sql');
      assertSqlAuthoringAllowed(sqlEnabled, parsed, new Set());
      const created = await ctx.dashboards.store.create(parsed);
      await recordAudit(ctx, req, { action: 'dashboard.create', entityType: 'dashboard', entityId: created.id, before: null, after: created });
      return created;
    } catch (err) { return mapError(err, reply); }
  });

  app.put('/api/dashboards/:id', EDIT, async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      const parsed = DashboardSchema.parse(req.body);
      const before = await ctx.dashboards.store.get(id);
      // UPDATE: unchanged SQL widgets (SQL text matches what's already persisted) are exempt, so
      // layout/chart/config edits save; only genuinely new/changed SQL is authoring and gated.
      const sqlEnabled = await ctx.featureFlags.get('dashboard.raw_sql');
      assertSqlAuthoringAllowed(sqlEnabled, parsed, persistedSqlTemplates(before));
      const updated = await ctx.dashboards.store.update(id, parsed);
      await recordAudit(ctx, req, { action: 'dashboard.update', entityType: 'dashboard', entityId: id, before, after: updated });
      return updated;
    } catch (err) { return mapError(err, reply); }
  });

  app.delete('/api/dashboards/:id', DELETE, async (req) => {
    const { id } = req.params as { id: string };
    const before = await ctx.dashboards.store.get(id);
    await ctx.dashboards.store.remove(id);
    if (before) {
      await recordAudit(ctx, req, { action: 'dashboard.delete', entityType: 'dashboard', entityId: id, before, after: null });
    }
    return { ok: true };
  });
}

function mapError(err: unknown, reply: FastifyReply): { error: string } {
  if (err instanceof ZodError) { reply.code(400); return { error: 'invalid payload' }; }
  if (err instanceof DashboardQueryError || (err instanceof Error && err.name === 'DashboardQueryError')) {
    reply.code(400); return { error: (err as Error).message };
  }
  // Postgres unique-violation (SQLSTATE 23505): a concurrent create hit a unique constraint
  // (e.g. the id PK or a name index). That is a conflict, not a server fault — surface 409.
  if (typeof err === 'object' && err !== null && (err as { code?: unknown }).code === '23505') {
    reply.code(409); return { error: 'already exists' };
  }
  const msg = err instanceof Error ? err.message : String(err);
  const isConn = /ECONNREFUSED|ETIMEDOUT|connection|connect/i.test(msg);
  reply.code(isConn ? 503 : 500);
  return { error: msg };
}
