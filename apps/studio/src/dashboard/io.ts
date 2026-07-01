import type { Dashboard, WidgetConfig, WidgetQuery, WidgetVariableDef } from '../api';

// A dashboard exported by corlix (or this app) carries widgets in one of two shapes:
//  - native:  { ..., query: WidgetQuery }
//  - corlix:  { ..., dataSourceId: 'custom-sql', params: { sql, variables, variableBindings } }
// Import normalises both into our native `query` shape.
interface ImportedWidget {
  id: string;
  type: string;
  title: string;
  query?: WidgetQuery;
  dataSourceId?: string;
  params?: { sql?: string; variables?: Record<string, WidgetVariableDef>; variableBindings?: Record<string, string> };
  refreshIntervalSec?: number;
  visual?: Record<string, unknown>;
}
interface ImportedDashboard {
  name?: string;
  layout?: unknown[];
  widgets?: ImportedWidget[];
  filters?: unknown[];
  refreshIntervalSec?: number;
}

/** Append " (2)", " (3)", … to `name` until it no longer collides with `existing`. */
export function uniqueName(name: string, existing: string[]): string {
  if (!existing.includes(name)) return name;
  for (let n = 2; ; n++) {
    const candidate = `${name} (${n})`;
    if (!existing.includes(candidate)) return candidate;
  }
}

function toWidget(w: ImportedWidget): WidgetConfig {
  const query: WidgetQuery = w.query
    ? w.query
    : {
        mode: 'sql',
        sql: w.params?.sql ?? '',
        ...(w.params?.variables ? { variables: w.params.variables } : {}),
        ...(w.params?.variableBindings ? { variableBindings: w.params.variableBindings } : {}),
      };
  return {
    id: w.id,
    type: w.type,
    title: w.title,
    query,
    refreshIntervalSec: w.refreshIntervalSec ?? 0,
    visual: w.visual ?? {},
  };
}

/**
 * Normalise an imported dashboard JSON into a fresh, non-default Dashboard owned by no one,
 * transforming corlix `dataSourceId`/`params` widgets into native sql queries and de-duplicating
 * the name against `existingNames`.
 */
export function importDashboard(raw: unknown, existingNames: string[]): Dashboard {
  const d = (raw ?? {}) as ImportedDashboard;
  return {
    id: crypto.randomUUID(),
    ownerId: null,
    name: uniqueName(d.name?.trim() || 'Imported dashboard', existingNames),
    layout: (d.layout ?? []) as Dashboard['layout'],
    widgets: (d.widgets ?? []).map(toWidget),
    filters: (d.filters ?? []) as Dashboard['filters'],
    refreshIntervalSec: d.refreshIntervalSec ?? 0,
    isDefault: false,
  };
}

/** Serialise a dashboard to a portable JSON string, dropping instance-specific fields. */
export function exportDashboard(d: Dashboard): string {
  const portable = {
    name: d.name,
    layout: d.layout,
    widgets: d.widgets,
    filters: d.filters,
    refreshIntervalSec: d.refreshIntervalSec,
  };
  return JSON.stringify(portable, null, 2);
}
