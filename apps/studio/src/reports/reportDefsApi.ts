import { authFetch, type ReportCategory } from '../api';

export interface ReportDefInput {
  id: string;
  name: string;
  description: string;
  category: ReportCategory;
  designId: string;
  primaryQueryId: string;
  summaryMetrics?: unknown[];
  chart?: unknown;
  paramOptions?: Record<string, string>;
  status: 'draft' | 'published';
}
export interface ReportDefRecord extends ReportDefInput {
  createdAt?: string;
  updatedAt?: string;
}

export async function listReportDefs(): Promise<ReportDefRecord[]> {
  const res = await authFetch('/api/report-defs');
  if (!res.ok) throw new Error(`report-defs ${res.status}`);
  return res.json() as Promise<ReportDefRecord[]>;
}

export async function createReportDef(input: ReportDefInput): Promise<ReportDefRecord> {
  const res = await authFetch('/api/report-defs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`create report-def ${res.status}`);
  return res.json() as Promise<ReportDefRecord>;
}

export async function deleteReportDef(id: string): Promise<void> {
  const res = await authFetch(`/api/report-defs/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!res.ok && res.status !== 204) throw new Error(`delete report-def ${res.status}`);
}

export async function getReportDef(id: string): Promise<ReportDefRecord> {
  const res = await authFetch(`/api/report-defs/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(`report-def ${id} ${res.status}`);
  return res.json() as Promise<ReportDefRecord>;
}

/** Flips a report-def's published/draft status via a full-body PUT (the server validates the whole record). */
export async function setReportStatus(id: string, status: 'draft' | 'published'): Promise<void> {
  const record = await getReportDef(id);
  const res = await authFetch(`/api/report-defs/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...record, status }),
  });
  if (!res.ok) throw new Error(`update report-def ${id} ${res.status}`);
}
