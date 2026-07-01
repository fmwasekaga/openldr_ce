import type { Dashboard } from './types';
import type { DashboardStore } from './store';
import { SAMPLE_DASHBOARD } from './samples';

/**
 * Build the vetted SQL-template set from a list of stored dashboards: every `mode:'sql'` widget
 * SQL string (trimmed). These templates are first-party — the server-seeded sample plus anything
 * an admin persisted while DASHBOARD_SQL_ENABLED was on (the authoring gate blocks untrusted SQL
 * when the flag is off). A submitted SQL template that exact-matches this set is safe to execute
 * even with the flag off, because it can only be admin-authored SQL.
 */
export function collectVettedSqlTemplates(dashboards: Dashboard[]): Set<string> {
  const set = new Set<string>();
  for (const d of dashboards) {
    for (const w of d.widgets) {
      if (w.query.mode === 'sql' && typeof w.query.sql === 'string') set.add(w.query.sql.trim());
    }
  }
  return set;
}

/** Whether a submitted SQL query may execute: the flag is on, OR its (trimmed) template exact-
 *  matches a vetted stored template. Pure — the caller supplies the template set. */
export function isSqlExecutionAllowed(sqlEnabled: boolean, submittedSql: string, vetted: Set<string>): boolean {
  return sqlEnabled || vetted.has(submittedSql.trim());
}

/**
 * Server-seed the vetted sample dashboard through the STORE (not the HTTP authoring route, so
 * its `mode:'sql'` widgets are exempt from the authoring gate). Idempotent by id `default`:
 * the store's `create` is `ON CONFLICT DO NOTHING`, so re-runs no-op. Returns the number of
 * dashboards created (0 or 1).
 */
export async function seedDefaultDashboard(store: Pick<DashboardStore, 'get' | 'create'>): Promise<number> {
  if (await store.get(SAMPLE_DASHBOARD.id)) return 0;
  await store.create(SAMPLE_DASHBOARD);
  return 1;
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
