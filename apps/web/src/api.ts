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

// ── Dashboard types & API client ──────────────────────────────────────────────

export interface WidgetVariableDef {
  type: 'text' | 'number' | 'date' | 'date-range';
  label: string;
  options?: string[];
  optionsSql?: string;
  defaultValue?: string | number | null;
  defaultRange?: { from: string; to: string } | null;
}

export type WidgetQuery =
  | { mode: 'builder'; model: string; metric: { key: string; label?: string; agg: string; column?: string };
      dimension?: { key: string; grain?: string }; filters: { dimension: string; op: string; value: unknown }[];
      variableBindings?: Record<string, string> }
  | { mode: 'sql'; sql: string; variableBindings?: Record<string, string>; variables?: Record<string, WidgetVariableDef> };

export interface WidgetConfig {
  id: string; type: string; title: string; query: WidgetQuery; refreshIntervalSec: number; visual: Record<string, unknown>;
}
export interface LayoutItem { i: string; x: number; y: number; w: number; h: number; minW?: number; minH?: number }
export interface DashboardFilterDef { id: string; label: string; type: 'text' | 'number' | 'date' | 'date-range'; defaultValue?: string | number | null; defaultRange?: { from: string; to: string } | null; options?: string[]; optionsSql?: string }
export interface Dashboard {
  id: string; ownerId: string | null; name: string; layout: LayoutItem[]; widgets: WidgetConfig[];
  filters: DashboardFilterDef[]; refreshIntervalSec: number; isDefault: boolean; createdAt?: string; updatedAt?: string;
}
export interface ModelDimension { key: string; label: string; column: string; kind: 'string' | 'date' | 'number'; dateGrain?: string[] }
export interface ModelMetric { key: string; label: string; agg: string; column?: string }
export interface QueryModel { id: string; label: string; dimensions: ModelDimension[]; metrics: ModelMetric[] }

const json = (body: unknown) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

export async function listModels(): Promise<QueryModel[]> {
  const r = await fetch('/api/dashboards/models'); if (!r.ok) throw new Error(`models failed: ${r.status}`); return r.json();
}
export async function runWidgetQuery(q: WidgetQuery): Promise<ReportResult> {
  const r = await fetch('/api/dashboards/query', json(q));
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `query failed: ${r.status}`);
  return r.json();
}
export async function listDashboards(): Promise<Dashboard[]> {
  const r = await fetch('/api/dashboards'); if (!r.ok) throw new Error(`list failed: ${r.status}`); return r.json();
}
export async function getDashboard(id: string): Promise<Dashboard> {
  const r = await fetch(`/api/dashboards/${id}`); if (!r.ok) throw new Error(`get failed: ${r.status}`); return r.json();
}
export async function createDashboard(d: Dashboard): Promise<Dashboard> {
  const r = await fetch('/api/dashboards', json(d)); if (!r.ok) throw new Error(`create failed: ${r.status}`); return r.json();
}
export async function saveDashboard(d: Dashboard): Promise<Dashboard> {
  const r = await fetch(`/api/dashboards/${d.id}`, { ...json(d), method: 'PUT' }); if (!r.ok) throw new Error(`save failed: ${r.status}`); return r.json();
}
export async function deleteDashboard(id: string): Promise<void> {
  const r = await fetch(`/api/dashboards/${id}`, { method: 'DELETE' }); if (!r.ok) throw new Error(`delete failed: ${r.status}`);
}

export interface ClientConfig { dashboardSqlEnabled: boolean }
export async function fetchClientConfig(): Promise<ClientConfig> {
  const r = await fetch('/api/config'); if (!r.ok) return { dashboardSqlEnabled: false }; return r.json();
}

// ── Terminology admin types & client ─────────────────────────────────────────
export type PublisherRole = 'local' | 'standard' | 'external';
export interface Publisher { id: string; name: string; role: PublisherRole; icon: string | null; seeded: boolean; sortOrder: number }
export interface PublisherInput { name: string; role: PublisherRole; icon?: string | null }
export interface CodingSystem {
  id: string; systemCode: string; systemName: string; url: string | null;
  systemVersion: string | null; description: string | null; active: boolean;
  publisherId: string | null; seeded: boolean;
}
export interface CodingSystemInput {
  systemCode: string; systemName: string; url?: string | null; systemVersion?: string | null;
  description?: string | null; active: boolean; publisherId?: string | null;
}

const jbody = (body: unknown, method: string) => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
async function okJson<T>(res: Response, what: string): Promise<T> {
  if (!res.ok) throw new Error(`${what} failed: ${res.status}`);
  return res.json() as Promise<T>;
}

export const listPublishers = () => fetch('/api/terminology/publishers').then((r) => okJson<Publisher[]>(r, 'list publishers'));
export const createPublisher = (i: PublisherInput) => fetch('/api/terminology/publishers', jbody(i, 'POST')).then((r) => okJson<Publisher>(r, 'create publisher'));
export const updatePublisher = (id: string, i: PublisherInput) => fetch(`/api/terminology/publishers/${id}`, jbody(i, 'PUT')).then((r) => okJson<Publisher>(r, 'update publisher'));
export async function deletePublisher(id: string): Promise<void> {
  const r = await fetch(`/api/terminology/publishers/${id}`, { method: 'DELETE' });
  if (!r.ok && r.status !== 204) throw new Error(`delete publisher failed: ${r.status}`);
}
export const publisherDeletionImpact = (id: string) => fetch(`/api/terminology/publishers/${id}/deletion-impact`).then((r) => okJson<{ systemCount: number; termCount: number }>(r, 'impact'));

export const listCodingSystems = (publisher?: string) => fetch(`/api/terminology/systems${publisher ? `?publisher=${encodeURIComponent(publisher)}` : ''}`).then((r) => okJson<CodingSystem[]>(r, 'list systems'));
export const createCodingSystem = (i: CodingSystemInput) => fetch('/api/terminology/systems', jbody(i, 'POST')).then((r) => okJson<CodingSystem>(r, 'create system'));
export const updateCodingSystem = (id: string, i: CodingSystemInput) => fetch(`/api/terminology/systems/${id}`, jbody(i, 'PUT')).then((r) => okJson<CodingSystem>(r, 'update system'));
export async function deleteCodingSystem(id: string): Promise<void> {
  const r = await fetch(`/api/terminology/systems/${id}`, { method: 'DELETE' });
  if (!r.ok && r.status !== 204) throw new Error(`delete system failed: ${r.status}`);
}
export const systemDeletionImpact = (id: string) => fetch(`/api/terminology/systems/${id}/deletion-impact`).then((r) => okJson<{ termCount: number; mappingCount: number }>(r, 'impact'));
