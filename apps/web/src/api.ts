export interface ReportSummary { id: string; name: string; description: string }
export interface ChartHint {
  type: 'bar' | 'line' | 'pie' | 'stat';
  x?: string; y?: string; series?: string; label?: string; value?: string;
}
export interface ReportColumn { key: string; label: string; kind: 'string' | 'number' | 'percent' | 'date' }
export interface ReportResult {
  columns: ReportColumn[];
  rows: Record<string, unknown>[];
  chart: ChartHint;
  meta: { generatedAt: string; rowCount: number };
}

export async function fetchReports(): Promise<ReportSummary[]> {
  const res = await fetch('/api/reports');
  if (!res.ok) throw new Error(`reports list failed: ${res.status}`);
  return res.json() as Promise<ReportSummary[]>;
}

export async function fetchReport(id: string, params: Record<string, string> = {}): Promise<ReportResult> {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`/api/reports/${id}${qs ? `?${qs}` : ''}`);
  if (!res.ok) throw new Error(`report ${id} failed: ${res.status}`);
  return res.json() as Promise<ReportResult>;
}

export function csvUrl(id: string, params: Record<string, string> = {}): string {
  const qs = new URLSearchParams(params).toString();
  return `/api/reports/${id}.csv${qs ? `?${qs}` : ''}`;
}
