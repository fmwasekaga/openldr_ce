import { authFetch } from '../api';

/** A single entry in the global, editable report-category list (mirrors
 *  packages/reporting's ReportCategoryEntry — studio can't import that package directly, see
 *  the query-model-expansion workstream's "studio hand-mirrors" convention). */
export interface ReportCategory {
  id: string;
  label: string;
  order: number;
}

export async function listReportCategories(): Promise<ReportCategory[]> {
  const res = await authFetch('/api/report-categories');
  if (!res.ok) throw new Error(`report-categories list failed: ${res.status}`);
  return res.json() as Promise<ReportCategory[]>;
}

/** Persists the FULL replacement list (server contract: PUT replaces wholesale). */
export async function saveReportCategories(list: ReportCategory[]): Promise<ReportCategory[]> {
  const res = await authFetch('/api/report-categories', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(list),
  });
  if (!res.ok) throw new Error(`save report-categories failed: ${res.status}`);
  return res.json() as Promise<ReportCategory[]>;
}
