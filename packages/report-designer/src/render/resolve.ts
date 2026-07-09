import type { ReportDesign } from '../schema';
import type { ResolvedTable } from './index';

export type RunQuery = (queryId: string, values: Record<string, unknown>) => Promise<{ columns: { key: string; label: string }[]; rows: Record<string, unknown>[] }>;

/** Run every bound table's query with `values`; elId → rows|error (never throws per-table). */
export async function resolveDesignTables(
  design: ReportDesign, values: Record<string, unknown>, runQuery: RunQuery,
): Promise<Map<string, ResolvedTable>> {
  const resolved = new Map<string, ResolvedTable>();
  for (const page of design.pages) {
    for (const el of page.elements) {
      if (el.kind !== 'table' || !el.dataSource) continue;
      try {
        const { columns, rows } = await runQuery(el.dataSource.queryId, values);
        resolved.set(el.id, { columns, rows });
      } catch (e) {
        resolved.set(el.id, { error: (e as Error).message });
      }
    }
  }
  return resolved;
}
