import type { Dashboard } from './types';
import type { DashboardStore } from './store';
import { SAMPLE_DASHBOARD } from './samples';

/**
 * Build the vetted SQL-template set from a list of stored dashboards: every `mode:'sql'` widget
 * SQL string, plus every first-party filter/variable `optionsSql` (the queries that populate
 * filter dropdowns), all trimmed. These templates are first-party — the server-seeded sample plus
 * anything an admin persisted while the `dashboard.raw_sql` feature flag was on (the authoring gate
 * blocks untrusted SQL when the flag is off). A submitted SQL template that exact-matches this set
 * is safe to execute even with the flag off, because it can only be admin-authored SQL. Filter
 * option queries must be included or the sample dashboard's dropdowns fail with the flag off.
 */
export function collectVettedSqlTemplates(dashboards: Dashboard[]): Set<string> {
  const set = new Set<string>();
  const add = (sql: unknown) => { if (typeof sql === 'string' && sql.trim()) set.add(sql.trim()); };
  for (const d of dashboards) {
    for (const f of d.filters) add(f.optionsSql);
    for (const w of d.widgets) {
      if (w.query.mode === 'sql') {
        add(w.query.sql);
        for (const v of Object.values(w.query.variables ?? {})) add(v.optionsSql);
      }
    }
  }
  return set;
}

/** Whether a submitted SQL query may execute: the flag is on, OR its (trimmed) template exact-
 *  matches a vetted stored template. Pure — the caller supplies the template set. */
export function isSqlExecutionAllowed(sqlEnabled: boolean, submittedSql: string, vetted: Set<string>): boolean {
  return sqlEnabled || vetted.has(submittedSql.trim());
}

// Compare only the seed-relevant fields — id/ownerId/isDefault/timestamps are store-managed and
// must not trigger a spurious refresh.
function dashboardContentEqual(a: Dashboard, b: Dashboard): boolean {
  const pick = (d: Dashboard) => JSON.stringify({ name: d.name, filters: d.filters, widgets: d.widgets, layout: d.layout });
  return pick(a) === pick(b);
}

/**
 * Server-seed the vetted sample dashboard through the STORE (not the HTTP authoring route, so
 * its `mode:'sql'` widgets are exempt from the authoring gate). Create-or-refresh by id `default`:
 * if absent, it's created; if present but its content (name/filters/widgets/layout) differs from
 * the currently shipped SAMPLE_DASHBOARD, it's overwritten (managed-overwrite) to heal an upgraded
 * install whose stored copy predates a widget-SQL rewrite (e.g. the R3e canonical-table cutover).
 * This replaces any operator customization of the `default` board — the accepted tradeoff of the
 * managed-overwrite policy. A no-op (returns 0) once the stored content already matches. Returns
 * the number of dashboards created-or-refreshed (0 or 1).
 */
export async function seedDefaultDashboard(store: Pick<DashboardStore, 'get' | 'create' | 'update'>): Promise<number> {
  const existing = await store.get(SAMPLE_DASHBOARD.id);
  if (!existing) {
    await store.create(SAMPLE_DASHBOARD);
    return 1;
  }
  if (!dashboardContentEqual(existing, SAMPLE_DASHBOARD)) {
    await store.update(SAMPLE_DASHBOARD.id, SAMPLE_DASHBOARD);
    return 1;
  }
  return 0;
}

export const DEFAULT_DASHBOARD: Dashboard = {
  id: 'default', ownerId: null, name: 'Overview', refreshIntervalSec: 0, isDefault: true,
  filters: [],
  widgets: [
    { id: 'w-orders', type: 'kpi', title: 'Total Orders', refreshIntervalSec: 0, visual: {},
      query: { mode: 'builder', model: 'service_requests', metric: { key: 'count', label: 'Orders', agg: 'count' }, filters: [] } },
    { id: 'w-trend', type: 'line-chart', title: 'Orders by Month', refreshIntervalSec: 0, visual: { xAxisKey: 'label', yAxisKey: 'value' },
      query: { mode: 'builder', model: 'service_requests', metric: { key: 'count', label: 'Orders', agg: 'count' }, dimension: { key: 'authored_on', grain: 'month' }, filters: [] } },
    { id: 'w-cat', type: 'bar-chart', title: 'Orders by Test', refreshIntervalSec: 0, visual: { xAxisKey: 'label', yAxisKey: 'value' },
      query: { mode: 'builder', model: 'service_requests', metric: { key: 'count', label: 'Orders', agg: 'count' }, dimension: { key: 'code_text' }, filters: [] } },
  ],
  layout: [
    { i: 'w-orders', x: 0, y: 0, w: 3, h: 2 },
    { i: 'w-trend', x: 3, y: 0, w: 6, h: 4 },
    { i: 'w-cat', x: 0, y: 2, w: 6, h: 4 },
  ],
};
