import { getAccessToken } from './auth/token';

/** fetch wrapper that attaches the bearer token when one is present. */
export function authFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const token = getAccessToken();
  if (!token) return init !== undefined ? fetch(input, init) : fetch(input);
  const headers = new Headers(init?.headers);
  headers.set('Authorization', `Bearer ${token}`);
  return fetch(input, { ...init, headers });
}

export type ReportCategory = 'amr' | 'operational' | 'quality' | 'regulatory';
export interface ReportParamMeta {
  id: string;
  label: string;
  type: 'daterange' | 'select' | 'text';
  required: boolean;
  optionsKey?: string;
}
export interface ReportMetricMeta {
  id: string;
  label: string;
  type: 'count' | 'sum' | 'avg' | 'pct';
  column?: string;
  match?: string;
}
export interface ReportSummary {
  id: string;
  name: string;
  description: string;
  category: ReportCategory;
  parameters: ReportParamMeta[];
  summaryMetrics?: ReportMetricMeta[];
}
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
  const res = await authFetch('/api/reports');
  if (!res.ok) throw new Error(`reports list failed: ${res.status}`);
  return res.json() as Promise<ReportSummary[]>;
}

export async function fetchReport(id: string, params: Record<string, string> = {}): Promise<ReportResult> {
  const qs = new URLSearchParams(params).toString();
  const res = await authFetch(`/api/reports/${id}${qs ? `?${qs}` : ''}`);
  if (!res.ok) throw new Error(`report ${id} failed: ${res.status}`);
  return res.json() as Promise<ReportResult>;
}

export async function fetchReportOptions(id: string): Promise<Record<string, string[]>> {
  const res = await authFetch(`/api/reports/${encodeURIComponent(id)}/options`);
  if (!res.ok) throw new Error(`report options ${id} failed: ${res.status}`);
  return res.json() as Promise<Record<string, string[]>>;
}

export async function fetchReportPdf(id: string, params: Record<string, string> = {}): Promise<Blob> {
  const qs = new URLSearchParams(params).toString();
  const res = await authFetch(`/api/reports/${encodeURIComponent(id)}.pdf${qs ? `?${qs}` : ''}`);
  if (!res.ok) throw new Error(`report pdf ${id} failed: ${res.status}`);
  return res.blob();
}

export function csvUrl(id: string, params: Record<string, string> = {}): string {
  const qs = new URLSearchParams(params).toString();
  return `/api/reports/${id}.csv${qs ? `?${qs}` : ''}`;
}

export interface ReportRun {
  id: string;
  reportId: string;
  reportName: string;
  format: 'preview' | 'csv' | 'pdf' | 'xlsx';
  params: Record<string, string>;
  rowCount: number | null;
  userName: string | null;
  createdAt: string;
}

export async function logReportRun(
  id: string,
  body: { format: ReportRun['format']; rowCount?: number | null; params?: Record<string, string> },
): Promise<void> {
  try {
    await authFetch(`/api/reports/${encodeURIComponent(id)}/runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    // Fire-and-forget: logging must never block the user's action.
  }
}

export async function fetchReportRuns(
  opts: { reportId?: string; limit?: number; offset?: number } = {},
): Promise<{ runs: ReportRun[]; total: number }> {
  const qs = new URLSearchParams();
  if (opts.reportId) qs.set('reportId', opts.reportId);
  if (opts.limit != null) qs.set('limit', String(opts.limit));
  if (opts.offset != null) qs.set('offset', String(opts.offset));
  const q = qs.toString();
  const res = await authFetch(`/api/reports/runs${q ? `?${q}` : ''}`);
  if (!res.ok) throw new Error(`report runs failed: ${res.status}`);
  return res.json() as Promise<{ runs: ReportRun[]; total: number }>;
}

export async function downloadReportCsv(id: string, params: Record<string, string> = {}): Promise<void> {
  const qs = new URLSearchParams(params).toString();
  const res = await authFetch(`/api/reports/${encodeURIComponent(id)}.csv${qs ? `?${qs}` : ''}`);
  if (!res.ok) throw new Error(`report csv ${id} failed: ${res.status}`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${id}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ── Report schedule types & API client ───────────────────────────────────────

export interface ReportSchedule {
  id: string;
  reportId: string;
  params: Record<string, string>;
  frequency: 'daily' | 'weekly' | 'monthly' | 'quarterly';
  dayOfWeek: number | null;
  dayOfMonth: number | null;
  outputFormat: 'csv' | 'xlsx' | 'pdf';
  enabled: boolean;
  lastRunAt: string | null;
  nextDueAt: string | null;
  createdBy: string | null;
}
export interface ReportScheduleRun {
  id: string;
  scheduleId: string;
  reportId: string;
  reportName: string;
  runAt: string;
  periodStart: string | null;
  periodEnd: string | null;
  outputFormat: string;
  objectKey: string | null;
  byteSize: number | null;
  rowCount: number | null;
  status: 'success' | 'failed';
  errorMessage: string | null;
}
export interface ScheduleInput {
  frequency: ReportSchedule['frequency'];
  dayOfWeek?: number | null;
  dayOfMonth?: number | null;
  outputFormat: ReportSchedule['outputFormat'];
  params?: Record<string, string>;
}

export async function fetchSchedules(
  reportId: string,
  opts: { limit?: number; offset?: number } = {},
): Promise<{ schedules: ReportSchedule[]; total: number }> {
  const qs = new URLSearchParams();
  if (opts.limit != null) qs.set('limit', String(opts.limit));
  if (opts.offset != null) qs.set('offset', String(opts.offset));
  const q = qs.toString();
  const res = await authFetch(`/api/reports/${encodeURIComponent(reportId)}/schedules${q ? `?${q}` : ''}`);
  if (!res.ok) throw new Error(`schedules ${reportId} failed: ${res.status}`);
  return res.json() as Promise<{ schedules: ReportSchedule[]; total: number }>;
}
export async function createSchedule(reportId: string, body: ScheduleInput): Promise<ReportSchedule> {
  const res = await authFetch(`/api/reports/${encodeURIComponent(reportId)}/schedules`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`create schedule failed: ${res.status}`);
  return res.json() as Promise<ReportSchedule>;
}
export async function updateSchedule(sid: string, patch: Partial<ScheduleInput> & { enabled?: boolean }): Promise<ReportSchedule> {
  const res = await authFetch(`/api/reports/schedules/${encodeURIComponent(sid)}`, {
    method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`update schedule failed: ${res.status}`);
  return res.json() as Promise<ReportSchedule>;
}
export async function deleteSchedule(sid: string): Promise<void> {
  const res = await authFetch(`/api/reports/schedules/${encodeURIComponent(sid)}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`delete schedule failed: ${res.status}`);
}
export async function runScheduleNow(sid: string): Promise<void> {
  const res = await authFetch(`/api/reports/schedules/${encodeURIComponent(sid)}/run`, { method: 'POST' });
  if (!res.ok) throw new Error(`run schedule failed: ${res.status}`);
}
export async function fetchScheduleRuns(
  opts: { reportId?: string; scheduleId?: string; limit?: number; offset?: number } = {},
): Promise<{ runs: ReportScheduleRun[]; total: number }> {
  const qs = new URLSearchParams();
  if (opts.reportId) qs.set('reportId', opts.reportId);
  if (opts.scheduleId) qs.set('scheduleId', opts.scheduleId);
  if (opts.limit != null) qs.set('limit', String(opts.limit));
  if (opts.offset != null) qs.set('offset', String(opts.offset));
  const q = qs.toString();
  const res = await authFetch(`/api/reports/schedule-runs${q ? `?${q}` : ''}`);
  if (!res.ok) throw new Error(`schedule runs failed: ${res.status}`);
  return res.json() as Promise<{ runs: ReportScheduleRun[]; total: number }>;
}
export async function downloadScheduleRun(runId: string): Promise<void> {
  const res = await authFetch(`/api/reports/schedule-runs/${encodeURIComponent(runId)}/download`);
  if (!res.ok) throw new Error(`download schedule run failed: ${res.status}`);
  const blob = await res.blob();
  const cd = res.headers.get('content-disposition') ?? '';
  const m = /filename="?([^"]+)"?/.exec(cd);
  const filename = m?.[1] ?? runId;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
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
  const r = await authFetch('/api/dashboards/models'); if (!r.ok) throw new Error(`models failed: ${r.status}`); return r.json();
}
export async function runWidgetQuery(q: WidgetQuery): Promise<ReportResult> {
  const r = await authFetch('/api/dashboards/query', json(q));
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `query failed: ${r.status}`);
  return r.json();
}
export async function listDashboards(): Promise<Dashboard[]> {
  const r = await authFetch('/api/dashboards'); if (!r.ok) throw new Error(`list failed: ${r.status}`); return r.json();
}
export async function getDashboard(id: string): Promise<Dashboard> {
  const r = await authFetch(`/api/dashboards/${id}`); if (!r.ok) throw new Error(`get failed: ${r.status}`); return r.json();
}
export async function createDashboard(d: Dashboard): Promise<Dashboard> {
  const r = await authFetch('/api/dashboards', json(d)); if (!r.ok) throw new Error(`create failed: ${r.status}`); return r.json();
}
export async function saveDashboard(d: Dashboard): Promise<Dashboard> {
  const r = await authFetch(`/api/dashboards/${d.id}`, { ...json(d), method: 'PUT' }); if (!r.ok) throw new Error(`save failed: ${r.status}`); return r.json();
}
export async function deleteDashboard(id: string): Promise<void> {
  const r = await authFetch(`/api/dashboards/${id}`, { method: 'DELETE' }); if (!r.ok) throw new Error(`delete failed: ${r.status}`);
}

export interface OidcConfig { issuerUrl: string; clientId: string; audience: string | null }
export interface ClientConfig { dashboardSqlEnabled: boolean; authEnforced: boolean; oidc: OidcConfig | null }
export async function fetchClientConfig(): Promise<ClientConfig> {
  const r = await authFetch('/api/config');
  if (!r.ok) return { dashboardSqlEnabled: false, authEnforced: false, oidc: null };
  return r.json();
}

// Audit
export interface AuditEvent {
  id: string;
  occurredAt: string;
  actorType: 'user' | 'system';
  actorId: string | null;
  actorName: string;
  action: string;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  metadata?: Record<string, unknown>;
}
export interface AuditQuery {
  action?: string;
  entityType?: string;
  entityId?: string;
  actorId?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}
export const queryAudit = (q: AuditQuery): Promise<{ events: AuditEvent[]; total: number }> => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) {
    if (v != null && v !== '') p.set(k, String(v));
  }
  return apiGet(`/api/audit?${p.toString()}`, 'query audit');
};
export const getAuditEvent = (id: string): Promise<AuditEvent> => apiGet(`/api/audit/${id}`, 'get audit event');

// Users
export interface User {
  id: string;
  subject: string | null;
  username: string;
  displayName: string | null;
  email: string | null;
  roles: string[];
  status: 'active' | 'disabled';
  lastLoginAt: string | null;
  createdAt: string | null;
}
export interface CreateUserInput {
  username: string;
  displayName?: string | null;
  email?: string | null;
  roles?: string[];
}
export const USER_ROLES = ['lab_admin', 'lab_manager', 'lab_technician', 'data_analyst', 'system_auditor'] as const;

/** SP6 composed model: Keycloak identity + local profile extras. */
export interface UserSummary {
  id: string;
  username: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  enabled: boolean;
  roles: string[];
  createdAt: string | null;
  extras: Record<string, string>;
  formSchemaId: string | null;
  formVersion: number | null;
}

export type CreateUserPayload = {
  username: string;
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  roles?: string[];
  password?: string;
  extras?: Record<string, { value: string; fhirPath: string | null }>;
  formSchemaId?: string | null;
  formVersion?: number | null;
};

export const listUsers = (): Promise<UserSummary[]> => apiGet('/api/users', 'list users');
export const createUser = (i: CreateUserPayload): Promise<UserSummary> =>
  authFetch('/api/users', jbody(i, 'POST')).then((r) => okJson<UserSummary>(r, 'create user'));
export const updateUser = (id: string, i: Partial<CreateUserPayload>): Promise<UserSummary> =>
  authFetch(`/api/users/${id}`, jbody(i, 'PUT')).then((r) => okJson<UserSummary>(r, 'update user'));
export const setUserStatus = (id: string, enabled: boolean): Promise<UserSummary> =>
  authFetch(`/api/users/${id}/status`, jbody({ enabled }, 'POST')).then((r) => okJson<UserSummary>(r, 'set user status'));
export const listPublishedForms = (targetPage: string): Promise<FormSummary[]> =>
  apiGet(`/api/forms/published?targetPage=${encodeURIComponent(targetPage)}`, 'list published forms');

export interface CurrentUser {
  id: string;
  username: string;
  displayName: string | null;
  roles: string[];
}
export const getMe = (): Promise<CurrentUser> =>
  authFetch('/api/me').then((res) => okJson<CurrentUser>(res, 'get current user'));
export const resetUserPassword = (id: string, password: string, temporary: boolean): Promise<void> =>
  authFetch(`/api/users/${id}/reset-password`, jbody({ password, temporary }, 'POST')).then((r) => { if (!r.ok) throw new Error(`reset password failed: ${r.status}`); });
export const sendUserResetEmail = (id: string): Promise<void> =>
  authFetch(`/api/users/${id}/send-reset-email`, { method: 'POST' }).then((r) => { if (!r.ok) throw new Error(`send reset email failed: ${r.status}`); });
export const forceUserLogout = (id: string): Promise<void> =>
  authFetch(`/api/users/${id}/force-logout`, { method: 'POST' }).then((r) => { if (!r.ok) throw new Error(`force logout failed: ${r.status}`); });

// Forms
export type FormStatus = 'draft' | 'published' | 'archived';
export interface FormSummary {
  id: string;
  name: string;
  versionLabel: string | null;
  status: FormStatus;
  active: boolean;
  fhirResourceType: string | null;
  targetPages: string[] | null;
  fieldCount: number;
  updatedAt: string;
}
export interface FormDefinition {
  id: string;
  name: string;
  versionLabel: string | null;
  fhirResourceType: string | null;
  fhirVersion?: string | null;
  fhirProfileUrl?: string | null;
  facilityId?: string | null;
  status: FormStatus;
  active: boolean;
  schema: unknown;
  targetPages: string[] | null;
  createdAt: string;
  updatedAt: string;
}
export interface CreateFormInput {
  name: string;
  schema: unknown;
  fhirResourceType?: string | null;
  fhirVersion?: string | null;
  fhirProfileUrl?: string | null;
  facilityId?: string | null;
  versionLabel?: string | null;
  targetPages?: string[] | null;
}
export type UpdateFormInput = CreateFormInput;
export interface PublishFormInput {
  versionLabel?: string | null;
}
export interface FormVersionSummary {
  id: string;
  formId: string;
  version: number;
  versionLabel: string | null;
  name: string;
  fhirResourceType: string | null;
  targetPages: string[] | null;
  publishedAt: string;
  publishedBy: string | null;
}
export interface FormVersion extends FormVersionSummary {
  schema: unknown;
  questionnaire: unknown;
}
export const listForms = (): Promise<FormSummary[]> => apiGet('/api/forms', 'list forms');
export const getForm = (id: string): Promise<FormDefinition> => apiGet(`/api/forms/${id}`, 'get form');
export const createForm = (i: CreateFormInput): Promise<FormDefinition> =>
  authFetch('/api/forms', jbody(i, 'POST')).then((r) => okJson<FormDefinition>(r, 'create form'));
export const updateForm = (id: string, i: UpdateFormInput): Promise<FormDefinition> =>
  authFetch(`/api/forms/${id}`, jbody(i, 'PUT')).then((r) => okJson<FormDefinition>(r, 'update form'));
export const publishForm = (id: string, i: PublishFormInput = {}): Promise<FormDefinition> =>
  authFetch(`/api/forms/${id}/publish`, jbody(i, 'POST')).then((r) => okJson<FormDefinition>(r, 'publish form'));
export const duplicateForm = (id: string): Promise<FormDefinition> =>
  authFetch(`/api/forms/${id}/duplicate`, jbody({}, 'POST')).then((r) => okJson<FormDefinition>(r, 'duplicate form'));
export const listFormVersions = (id: string): Promise<FormVersionSummary[]> =>
  apiGet(`/api/forms/${id}/versions`, 'list form versions');
export const getFormVersion = (id: string, version: number): Promise<FormVersion> =>
  apiGet(`/api/forms/${id}/versions/${version}`, 'get form version');
export const setFormStatus = (id: string, status: FormStatus): Promise<FormDefinition> =>
  authFetch(`/api/forms/${id}/status`, jbody({ status }, 'POST')).then((r) => okJson<FormDefinition>(r, 'set form status'));
export const deleteForm = (id: string): Promise<void> => apiDelete(`/api/forms/${id}`, 'delete form');
export const formQuestionnaireUrl = (id: string): string => `/api/forms/${id}/questionnaire`;
export async function exportFormBundle(id: string): Promise<void> {
  const r = await authFetch(`/api/forms/${encodeURIComponent(id)}/export-bundle`, { method: 'GET' });
  if (!r.ok) throw new Error(`export failed: ${r.status}`);
  const blob = await r.blob();
  const disposition = r.headers.get('Content-Disposition') ?? '';
  const match = /filename="([^"]+)"/.exec(disposition);
  const filename = match?.[1] ?? `${id}.zip`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}
export const submitFormResponse = (id: string, answers: unknown): Promise<unknown> =>
  authFetch(`/api/forms/${id}/responses`, jbody({ answers }, 'POST')).then((r) => okJson<unknown>(r, 'submit form response'));

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
async function errorDetail(res: Response): Promise<string> {
  const contentType = res.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    const body = await res.json().catch(() => null) as { error?: unknown; message?: unknown } | null;
    const detail = body?.error ?? body?.message;
    if (typeof detail === 'string' && detail.trim()) return detail.trim();
  }
  const text = await res.text().catch(() => '');
  return text.trim() || String(res.status);
}
async function okJson<T>(res: Response, what: string): Promise<T> {
  if (!res.ok) throw new Error(`${what} failed: ${await errorDetail(res)}`);
  return res.json() as Promise<T>;
}
const apiGet = <T>(url: string, what: string): Promise<T> => authFetch(url).then((res) => okJson<T>(res, what));
async function apiDelete(url: string, what: string): Promise<void> {
  const res = await authFetch(url, { method: 'DELETE' });
  if (!res.ok && res.status !== 204) throw new Error(`${what} failed: ${res.status}`);
}

export const listPublishers = () => authFetch('/api/terminology/publishers').then((r) => okJson<Publisher[]>(r, 'list publishers'));
export const createPublisher = (i: PublisherInput) => authFetch('/api/terminology/publishers', jbody(i, 'POST')).then((r) => okJson<Publisher>(r, 'create publisher'));
export const updatePublisher = (id: string, i: PublisherInput) => authFetch(`/api/terminology/publishers/${id}`, jbody(i, 'PUT')).then((r) => okJson<Publisher>(r, 'update publisher'));
export async function deletePublisher(id: string): Promise<void> {
  const r = await authFetch(`/api/terminology/publishers/${id}`, { method: 'DELETE' });
  if (!r.ok && r.status !== 204) throw new Error(`delete publisher failed: ${r.status}`);
}
export const publisherDeletionImpact = (id: string) => authFetch(`/api/terminology/publishers/${id}/deletion-impact`).then((r) => okJson<{ systemCount: number; termCount: number }>(r, 'impact'));

export const listCodingSystems = (publisher?: string) => authFetch(`/api/terminology/systems${publisher ? `?publisher=${encodeURIComponent(publisher)}` : ''}`).then((r) => okJson<CodingSystem[]>(r, 'list systems'));
export const createCodingSystem = (i: CodingSystemInput) => authFetch('/api/terminology/systems', jbody(i, 'POST')).then((r) => okJson<CodingSystem>(r, 'create system'));
export const updateCodingSystem = (id: string, i: CodingSystemInput) => authFetch(`/api/terminology/systems/${id}`, jbody(i, 'PUT')).then((r) => okJson<CodingSystem>(r, 'update system'));
export async function deleteCodingSystem(id: string): Promise<void> {
  const r = await authFetch(`/api/terminology/systems/${id}`, { method: 'DELETE' });
  if (!r.ok && r.status !== 204) throw new Error(`delete system failed: ${r.status}`);
}
export const systemDeletionImpact = (id: string) => authFetch(`/api/terminology/systems/${id}/deletion-impact`).then((r) => okJson<{ termCount: number; mappingCount: number }>(r, 'impact'));

// Value sets (SP3)
export interface ValueSetComposeConcept { code: string; display?: string }
export interface ValueSetComposeClause {
  system?: string; version?: string;
  concept?: ValueSetComposeConcept[];
  filter?: { property: string; op: string; value: string }[];
  valueSet?: string[];
}
export interface ValueSetCompose { include?: ValueSetComposeClause[]; exclude?: ValueSetComposeClause[] }
export interface ValueSet {
  id: string; url: string; version: string | null; name: string | null; title: string | null;
  status: string; experimental: boolean; description: string | null; compose: ValueSetCompose;
  immutable: boolean; category: string | null; publisherId: string | null;
}
export interface ValueSetCatalogImportResult {
  imported: number;
  skipped: number;
  valueSet: ValueSet | null;
}
export interface ValueSetSummary {
  id: string; url: string; name: string | null; title: string | null; version: string | null;
  status: string; immutable: boolean; publisherId: string | null; category: string | null;
  codeCount: number; primarySystem: string | null;
}
export interface ValueSetInput {
  url: string; version?: string | null; name?: string | null; title?: string | null;
  status: string; experimental?: boolean; description?: string | null; compose: ValueSetCompose;
  publisherId?: string | null; category?: string | null;
}
export interface ExpandedCode { system: string; code: string; display: string | null }
export interface TerminologyLoadResult { system: string; conceptsLoaded: number; resourceUrl: string }

export const listValueSets = (publisherId?: string): Promise<ValueSetSummary[]> =>
  authFetch(`/api/terminology/valuesets${publisherId ? `?publisherId=${encodeURIComponent(publisherId)}` : ''}`).then((r) => okJson<ValueSetSummary[]>(r, 'list value sets'));
export const getValueSet = (id: string): Promise<ValueSet> => authFetch(`/api/terminology/valuesets/${id}`).then((r) => okJson<ValueSet>(r, 'get value set'));
export const saveValueSet = (input: ValueSetInput): Promise<ValueSet> => authFetch('/api/terminology/valuesets', jbody(input, 'POST')).then((r) => okJson<ValueSet>(r, 'save value set'));
export async function deleteValueSet(id: string): Promise<void> {
  const r = await authFetch(`/api/terminology/valuesets/${id}`, { method: 'DELETE' });
  if (!r.ok && r.status !== 204) throw new Error(`delete value set failed: ${r.status}`);
}
export const duplicateValueSet = (id: string): Promise<ValueSet> => authFetch(`/api/terminology/valuesets/${id}/duplicate`, jbody({}, 'POST')).then((r) => okJson<ValueSet>(r, 'duplicate value set'));
export const expandValueSet = (id: string, activeOnly = true): Promise<{ codes: ExpandedCode[]; total: number }> =>
  authFetch(`/api/terminology/valuesets/${id}/expand?activeOnly=${activeOnly}`).then((r) => okJson<{ codes: ExpandedCode[]; total: number }>(r, 'expand value set'));
export const importValueSet = (resource: unknown | Blob): Promise<ValueSet | ValueSetCatalogImportResult> => {
  const init = resource instanceof Blob
    ? {
      method: 'POST',
      headers: { 'content-type': 'name' in resource && typeof resource.name === 'string' && resource.name.endsWith('.gz') ? 'application/gzip' : 'application/fhir+json' },
      body: resource,
    }
    : jbody(resource, 'POST');
  return authFetch('/api/terminology/valuesets/import', init).then((r) => okJson<ValueSet | ValueSetCatalogImportResult>(r, 'import value set'));
};
export const valueSetExportUrl = (id: string): string => `/api/terminology/valuesets/${id}/export`;
export const importLoincDistribution = (path: string, acceptLicense: boolean): Promise<TerminologyLoadResult> =>
  authFetch('/api/terminology/import/loinc', jbody({ path, acceptLicense }, 'POST')).then((r) => okJson<TerminologyLoadResult>(r, 'import LOINC distribution'));

// ── Terms + mappings (SP2) ───────────────────────────────────────────────────
export type TermStatus = 'ACTIVE' | 'DRAFT' | 'DEPRECATED' | 'DISABLED';
export type MapType = 'SAME-AS' | 'NARROWER-THAN' | 'BROADER-THAN' | 'RELATED-TO' | 'UNMAPPED-FROM';
export interface Term { system: string; code: string; display: string | null; status: string; shortName: string | null; class: string | null; unit: string | null; replacedBy: string | null; metadata: Record<string, unknown> | null; mappingCount: number }
export interface TermInput { code: string; display: string; status: TermStatus; shortName?: string | null; class?: string | null; unit?: string | null; replacedBy?: string | null; metadata?: Record<string, unknown> | null }
export interface TermMapping { id: string; fromSystem: string; fromCode: string; toSystem: string; toCode: string; toDisplay: string | null; mapType: MapType; relationship: string | null; owner: string | null; isActive: boolean }
export interface TermMappingInput { fromSystem: string; fromCode: string; toSystem: string; toCode: string; toDisplay: string | null; mapType: MapType; relationship?: string | null; owner?: string | null; isActive: boolean }

export const searchTerms = (systemId: string, p: { q?: string; status?: string; limit?: number; offset?: number }) => {
  const qs = new URLSearchParams();
  if (p.q) qs.set('q', p.q);
  if (p.status) qs.set('status', p.status);
  qs.set('limit', String(p.limit ?? 50));
  qs.set('offset', String(p.offset ?? 0));
  return authFetch(`/api/terminology/systems/${systemId}/terms?${qs}`).then((r) => okJson<{ rows: Term[]; total: number }>(r, 'search terms'));
};
export const createTerm = (systemId: string, i: TermInput) => authFetch(`/api/terminology/systems/${systemId}/terms`, jbody(i, 'POST')).then((r) => okJson<Term>(r, 'create term'));
export const updateTerm = (systemId: string, code: string, i: TermInput) => authFetch(`/api/terminology/systems/${systemId}/terms/${encodeURIComponent(code)}`, jbody(i, 'PUT')).then((r) => okJson<Term>(r, 'update term'));
export async function deleteTerm(systemId: string, code: string): Promise<void> {
  const r = await authFetch(`/api/terminology/systems/${systemId}/terms/${encodeURIComponent(code)}`, { method: 'DELETE' });
  if (!r.ok && r.status !== 204) throw new Error(`delete term failed: ${r.status}`);
}
export const importTerms = (systemId: string, source: string | Blob) => {
  const init = source instanceof Blob
    ? { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: source }
    : jbody({ text: source }, 'POST');
  return authFetch(`/api/terminology/systems/${systemId}/terms/import`, init).then((r) => okJson<{ imported: number }>(r, 'import terms'));
};
export const termsTemplateUrl = (systemId: string) => `/api/terminology/systems/${systemId}/terms/template.csv`;

export const listTermMappings = (system: string, code: string) =>
  authFetch(`/api/terminology/terms/${encodeURIComponent(system)}/${encodeURIComponent(code)}/mappings`).then((r) => okJson<{ outgoing: TermMapping[]; reverse: TermMapping[] }>(r, 'list mappings'));
export const createTermMapping = (system: string, code: string, i: Omit<TermMappingInput, 'fromSystem' | 'fromCode'>) =>
  authFetch(`/api/terminology/terms/${encodeURIComponent(system)}/${encodeURIComponent(code)}/mappings`, jbody(i, 'POST')).then((r) => okJson<{ mapping: TermMapping; draftCreated: boolean }>(r, 'create mapping'));
export const updateTermMapping = (id: string, i: TermMappingInput) => authFetch(`/api/terminology/mappings/${id}`, jbody(i, 'PUT')).then((r) => okJson<TermMapping>(r, 'update mapping'));
export async function deleteTermMapping(id: string): Promise<void> {
  const r = await authFetch(`/api/terminology/mappings/${id}`, { method: 'DELETE' });
  if (!r.ok && r.status !== 204) throw new Error(`delete mapping failed: ${r.status}`);
}

// Ontology browser (SP4)
export type OntologyType = 'loinc' | 'snomed' | 'rxnorm';
export interface OntologyNode {
  code: string;
  display: string;
  kind: string;
  extra: Record<string, unknown> | null;
  childCount: number;
  group: string | null;
}
export interface OntologyBreadcrumb {
  code: string;
  display: string;
}
export interface OntologyDistribution {
  codingSystemId: string;
  ontologyType: OntologyType;
  sourcePath: string;
  indexStatus: string;
  indexError: string | null;
  nodeCount: number | null;
  edgeCount: number | null;
  builtAt: string | null;
  updatedAt: string;
  stale?: boolean;
}
export interface OntologyBuildProgress {
  codingSystemId: string;
  phase: string;
  processed: number;
  total: number | null;
}
export interface PanelMember {
  panelLoinc: string;
  memberLoinc: string;
  memberName: string;
  displayName: string;
  sequence: number;
  required: boolean;
}
export interface AnswerOption {
  value: string;
  label: string;
}
export interface SpecimenCode {
  snomedCode: string;
  equivalence: string;
}

export const listOntologyDistributions = (): Promise<OntologyDistribution[]> =>
  apiGet('/api/terminology/ontology/distributions', 'list ontology distributions');
export const getOntologyDistribution = (id: string): Promise<(OntologyDistribution & { stale: boolean }) | null> =>
  apiGet(`/api/terminology/ontology/distributions/${id}`, 'get ontology distribution');
export const unlinkOntologyDistribution = (id: string): Promise<void> =>
  apiDelete(`/api/terminology/ontology/distributions/${id}`, 'unlink ontology distribution');
export const ontologyRoots = (id: string): Promise<OntologyNode[]> =>
  apiGet(`/api/terminology/ontology/${id}/roots`, 'ontology roots');
export const ontologyChildren = (id: string, parent: string): Promise<OntologyNode[]> =>
  apiGet(`/api/terminology/ontology/${id}/children?parent=${encodeURIComponent(parent)}`, 'ontology children');
export const ontologyNodeDetail = (id: string, code: string): Promise<OntologyNode | null> =>
  apiGet(`/api/terminology/ontology/${id}/node?code=${encodeURIComponent(code)}`, 'ontology node');
export const ontologySearch = (id: string, query: string): Promise<OntologyNode[]> =>
  apiGet(`/api/terminology/ontology/${id}/search?q=${encodeURIComponent(query)}`, 'ontology search');
export const ontologyPath = (id: string, code: string): Promise<OntologyBreadcrumb[]> =>
  apiGet(`/api/terminology/ontology/${id}/path?code=${encodeURIComponent(code)}`, 'ontology path');
export const ontologyPanelMembers = (id: string, loinc: string): Promise<PanelMember[]> =>
  apiGet(`/api/terminology/ontology/${id}/panels?loinc=${encodeURIComponent(loinc)}`, 'ontology panel members');
export const ontologyAnswerOptions = (id: string, loinc: string): Promise<AnswerOption[]> =>
  apiGet(`/api/terminology/ontology/${id}/answers?loinc=${encodeURIComponent(loinc)}`, 'ontology answer options');
export const ontologySpecimenCodes = (id: string, loinc: string): Promise<SpecimenCode[]> =>
  apiGet(`/api/terminology/ontology/${id}/specimens?loinc=${encodeURIComponent(loinc)}`, 'ontology specimen codes');

// ── DHIS2 admin (SP-A) ─────────────────────────────────────────────────────────
export interface Dhis2RecentPush {
  id: string;
  occurredAt: string;
  action: string;
  entityId: string;
  metadata?: Record<string, unknown>;
}
export interface Dhis2Status {
  configured: boolean;
  syncEnabled: boolean;
  host: string | null;
  reachable: { status: 'up' | 'down' | 'degraded'; latencyMs: number; detail?: string } | null;
  counts: { mappings: number; orgUnitMappings: number; schedules: number } | null;
  recentPushes: Dhis2RecentPush[];
}
export interface Dhis2MetadataCounts {
  dataElements: number;
  orgUnits: number;
  categoryOptionCombos: number;
  programs: number;
  programStages: number;
}

export async function getDhis2Status(): Promise<Dhis2Status> {
  const r = await authFetch('/api/dhis2/status');
  if (!r.ok) throw new Error(`dhis2 status failed: ${r.status}`);
  return r.json();
}

export async function pullDhis2Metadata(): Promise<Dhis2MetadataCounts> {
  const r = await authFetch('/api/dhis2/metadata/pull', { method: 'POST' });
  if (!r.ok) {
    const body = (await r.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `metadata pull failed: ${r.status}`);
  }
  return (await r.json()).counts;
}

// ── DHIS2 admin (SP-B) — OrgUnit mappings ────────────────────────────────────
export interface FacilityMapping {
  facilityId: string;
  facilityName: string;
  orgUnitId: string | null;
  orgUnitName: string | null;
}
export interface Dhis2OrgUnitMappings {
  facilities: FacilityMapping[];
  orgUnits: { id: string; name: string }[];
  metadataPulledAt: string | null;
}

export async function getOrgUnitMappings(): Promise<Dhis2OrgUnitMappings> {
  const r = await authFetch('/api/dhis2/orgunit-mappings');
  if (!r.ok) throw new Error(`orgunit mappings failed: ${r.status}`);
  return r.json();
}
export async function setOrgUnitMapping(facilityId: string, body: { orgUnitId: string; orgUnitName: string | null }): Promise<FacilityMapping> {
  const r = await authFetch(`/api/dhis2/orgunit-mappings/${encodeURIComponent(facilityId)}`, jbody(body, 'PUT'));
  if (!r.ok) throw new Error(`set mapping failed: ${r.status}`);
  return r.json();
}
export async function clearOrgUnitMapping(facilityId: string): Promise<void> {
  const r = await authFetch(`/api/dhis2/orgunit-mappings/${encodeURIComponent(facilityId)}`, { method: 'DELETE' });
  if (!r.ok) throw new Error(`clear mapping failed: ${r.status}`);
}

// ── DHIS2 aggregate mappings (SP-C1) ───────────────────────────────────────────
export interface Dhis2MappingSummary { id: string; name: string; kind: string | null }
export interface AggregateColumnMapping { column: string; dataElement: string; categoryOptionCombo?: string }
export interface AggregateMappingDef {
  kind?: 'aggregate';
  /** Connector that receives this mapping's push (resolved host-side from the definition). */
  connectorId?: string;
  id: string;
  name: string;
  source: { kind: 'report'; reportId: string; params?: Record<string, string> };
  orgUnitColumn: string;
  periodColumn?: string;
  columns: AggregateColumnMapping[];
}
export interface TrackerColumnMapping { column: string; dataElement: string }
export interface TrackerMappingDef {
  kind: 'tracker';
  /** Connector that receives this mapping's push (resolved host-side from the definition). */
  connectorId?: string;
  id: string;
  name: string;
  source: { kind: 'event-source'; sourceId: string; params?: Record<string, string> };
  program: string;
  programStage: string;
  orgUnitColumn: string;
  eventDateColumn: string;
  idColumn: string;
  dataValues: TrackerColumnMapping[];
}
export type MappingDef = AggregateMappingDef | TrackerMappingDef;
export interface Dhis2EventSource { id: string; name: string; columns: { key: string; label: string }[] }
export interface Dhis2MappingRecord { id: string; name: string; definition: AggregateMappingDef | Record<string, unknown> }
export interface ReportColumn2 { key: string; label: string }
export interface Dhis2MetadataLists {
  dataElements: { id: string; name: string }[];
  categoryOptionCombos: { id: string; name: string }[];
  orgUnits: { id: string; name: string }[];
  programs: { id: string; name: string }[];
  programStages: { id: string; name: string; program: string }[];
  pulledAt: string;
}

export async function listDhis2Mappings(): Promise<Dhis2MappingSummary[]> {
  const r = await authFetch('/api/dhis2/mappings');
  if (!r.ok) throw new Error(`mappings list failed: ${r.status}`);
  return r.json();
}
export async function getDhis2Mapping(id: string): Promise<Dhis2MappingRecord> {
  const r = await authFetch(`/api/dhis2/mappings/${encodeURIComponent(id)}`);
  if (!r.ok) throw new Error(`get mapping failed: ${r.status}`);
  return r.json();
}
export async function saveDhis2Mapping(id: string, body: { name: string; definition: MappingDef }): Promise<Dhis2MappingRecord> {
  const r = await authFetch(`/api/dhis2/mappings/${encodeURIComponent(id)}`, jbody(body, 'PUT'));
  if (!r.ok) throw new Error(`save mapping failed: ${r.status}`);
  return r.json();
}
export async function deleteDhis2Mapping(id: string): Promise<void> {
  const r = await authFetch(`/api/dhis2/mappings/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!r.ok) throw new Error(`delete mapping failed: ${r.status}`);
}
export async function validateDhis2Mapping(def: MappingDef): Promise<string[]> {
  const r = await authFetch('/api/dhis2/mappings/validate', jbody(def, 'POST'));
  if (!r.ok) throw new Error(`validate failed: ${r.status}`);
  return (await r.json()).problems as string[];
}
export async function getReportColumns(reportId: string): Promise<ReportColumn2[]> {
  const r = await authFetch(`/api/dhis2/report-columns?reportId=${encodeURIComponent(reportId)}`);
  if (!r.ok) { const b = (await r.json().catch(() => ({}))) as { error?: string }; throw new Error(b.error ?? `report columns failed: ${r.status}`); }
  return (await r.json()).columns as ReportColumn2[];
}
export async function getDhis2Metadata(): Promise<Dhis2MetadataLists | null> {
  const r = await authFetch('/api/dhis2/metadata');
  if (!r.ok) throw new Error(`metadata failed: ${r.status}`);
  return r.json();
}
export async function getDhis2EventSources(): Promise<Dhis2EventSource[]> {
  const r = await authFetch('/api/dhis2/event-sources');
  if (!r.ok) throw new Error(`event sources failed: ${r.status}`);
  return r.json();
}

// ── DHIS2 operations (SP-D) ────────────────────────────────────────────────────
export interface Dhis2PushResultClient { status: string; imported: number; updated: number; ignored: number; deleted: number; conflicts: { object: string; value: string }[] }
export interface Dhis2RunResult {
  kind: 'aggregate' | 'tracker';
  dryRun: boolean;
  counts: { values: number; skipped: number };
  skipped: { row: number; reason: string }[];
  result: Dhis2PushResultClient | null;
}
export interface Dhis2Push { id: string; occurredAt: string; action: string; entityId: string; metadata?: Record<string, unknown> }
export interface Dhis2Schedule {
  id: string; mappingId: string; mappingName: string;
  mode: 'aggregate' | 'tracker'; periodType: 'monthly' | 'quarterly' | 'yearly';
  eventDriven: boolean; enabled: boolean; lastRunAt: string | null; nextDueAt: string | null;
}

export async function runDhis2Mapping(id: string, body: { period: string; dryRun: boolean }): Promise<Dhis2RunResult> {
  const r = await authFetch(`/api/dhis2/mappings/${encodeURIComponent(id)}/run`, jbody(body, 'POST'));
  if (!r.ok) { const b = (await r.json().catch(() => ({}))) as { error?: string }; throw new Error(b.error ?? `run failed: ${r.status}`); }
  return r.json();
}
export async function listDhis2Pushes(limit = 50): Promise<Dhis2Push[]> {
  const r = await authFetch(`/api/dhis2/pushes?limit=${limit}`);
  if (!r.ok) throw new Error(`pushes failed: ${r.status}`);
  return r.json();
}
export async function listDhis2Schedules(): Promise<Dhis2Schedule[]> {
  const r = await authFetch('/api/dhis2/schedules');
  if (!r.ok) throw new Error(`schedules failed: ${r.status}`);
  return r.json();
}
export async function createDhis2Schedule(body: { mappingId: string; periodType: string; eventDriven: boolean }): Promise<Dhis2Schedule> {
  const r = await authFetch('/api/dhis2/schedules', jbody(body, 'POST'));
  if (!r.ok) throw new Error(`create schedule failed: ${r.status}`);
  return r.json();
}
export async function setDhis2ScheduleEnabled(id: string, enabled: boolean): Promise<void> {
  const r = await authFetch(`/api/dhis2/schedules/${encodeURIComponent(id)}/enabled`, jbody({ enabled }, 'POST'));
  if (!r.ok) throw new Error(`toggle schedule failed: ${r.status}`);
}
export async function deleteDhis2Schedule(id: string): Promise<void> {
  const r = await authFetch(`/api/dhis2/schedules/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!r.ok) throw new Error(`delete schedule failed: ${r.status}`);
}

// ── Marketplace (SP-4) ─────────────────────────────────────────────────────────
export interface AvailableArtifact {
  ref: string;
  id: string;
  version: string;
  type: string;
  publisher: { id: string; name: string } | null;
  capabilities?: unknown[];
  compatibility?: { ceVersion: string };
  valid?: boolean;
  description?: string;
  license?: string;
  summary?: string;
  signatureFingerprint?: string;
}
export interface ArtifactPayloadMeta {
  kind: string;
  entrypoint?: string;
  wasmSha256?: string;
  wasi?: boolean;
  limits?: { memoryMb: number; timeoutMs: number };
  [k: string]: unknown;
}
export interface AvailableArtifactDetail extends AvailableArtifact {
  compatible: boolean;
  ceVersion: string;
  readme?: string;
  payload: ArtifactPayloadMeta;
}
export interface InstalledArtifact {
  id: string;
  version: string;
  active: boolean;
  enabled: boolean;
  approvedBy: string | null;
  type: string;
  publisher: unknown;
  capabilities: unknown[];
  legacy: boolean;
  drifted?: boolean;
  targetFormId?: string;
}

export const listInstalledArtifacts = (): Promise<InstalledArtifact[]> =>
  apiGet('/api/marketplace/installed', 'list installed artifacts');

export const listAvailableArtifacts = (): Promise<{ configured: boolean; source: 'local' | 'http' | null; host: string | null; bundles: AvailableArtifact[]; error?: string }> =>
  apiGet('/api/marketplace/available', 'list available artifacts');

export async function refreshRegistry(): Promise<void> {
  const r = await authFetch('/api/marketplace/refresh', { method: 'POST' });
  if (!r.ok) throw new Error(`refresh failed: ${r.status}`);
}

export const getAvailableArtifact = (ref: string): Promise<AvailableArtifactDetail> =>
  apiGet(`/api/marketplace/available/${encodeURIComponent(ref)}`, 'get available artifact');

export const installArtifact = (ref: string, acknowledgedCapabilities: unknown[]): Promise<{ id: string; version: string }> =>
  authFetch('/api/marketplace/install', jbody({ ref, acknowledgedCapabilities }, 'POST')).then((r) => okJson<{ id: string; version: string }>(r, 'install artifact'));

export const getPublishStatus = (): Promise<{ configured: boolean; repo: string | null }> =>
  apiGet('/api/marketplace/publish/status', 'get publish status');

export const publishArtifact = (ref: string): Promise<{ prUrl: string; prNumber: number }> =>
  authFetch('/api/marketplace/publish', jbody({ ref }, 'POST')).then((r) => okJson<{ prUrl: string; prNumber: number }>(r, 'publish artifact'));

export async function setArtifactEnabled(id: string, enabled: boolean): Promise<void> {
  const endpoint = enabled ? 'enable' : 'disable';
  const r = await authFetch(`/api/marketplace/${encodeURIComponent(id)}/${endpoint}`, { method: 'POST' });
  if (!r.ok) throw new Error(`set artifact ${endpoint} failed: ${r.status}`);
}

export const rollbackArtifact = (id: string, version: string): Promise<void> =>
  authFetch(`/api/marketplace/${encodeURIComponent(id)}/rollback`, jbody({ version }, 'POST')).then(async (r) => {
    if (!r.ok) throw new Error(`rollback artifact failed: ${r.status}`);
  });

export async function removeArtifact(id: string, version?: string): Promise<void> {
  const qs = version ? `?version=${encodeURIComponent(version)}` : '';
  await apiDelete(`/api/marketplace/${encodeURIComponent(id)}${qs}`, 'remove artifact');
}

export async function detachArtifact(id: string): Promise<void> {
  const r = await authFetch(`/api/marketplace/${encodeURIComponent(id)}/detach`, { method: 'POST' });
  if (!r.ok) throw new Error(`detach failed: ${r.status}`);
}

export function buildOntology(
  id: string,
  opts: { path?: string; rebuild?: boolean },
  onProgress: (progress: OntologyBuildProgress) => void,
): { promise: Promise<OntologyDistribution>; cancel: () => void } {
  const token = getAccessToken();
  const tokenParam = token ? `${opts.rebuild ? '?' : '&'}access_token=${encodeURIComponent(token)}` : '';
  const url = (opts.rebuild
    ? `/api/terminology/ontology/${id}/rebuild`
    : `/api/terminology/ontology/${id}/build?path=${encodeURIComponent(opts.path ?? '')}`) + tokenParam;
  const eventSource = new EventSource(url);
  const promise = new Promise<OntologyDistribution>((resolve, reject) => {
    eventSource.addEventListener('progress', (event) => {
      try {
        onProgress(JSON.parse((event as MessageEvent).data) as OntologyBuildProgress);
      } catch {
        // Ignore malformed progress events; the terminal done/error event decides the outcome.
      }
    });
    eventSource.addEventListener('done', (event) => {
      eventSource.close();
      resolve(JSON.parse((event as MessageEvent).data) as OntologyDistribution);
    });
    eventSource.addEventListener('error', (event) => {
      const data = (event as MessageEvent).data;
      eventSource.close();
      reject(new Error(data ? ((JSON.parse(data) as { message?: string }).message ?? 'build failed') : 'connection lost'));
    });
  });
  return { promise, cancel: () => eventSource.close() };
}

// ── Workflow types & API client ───────────────────────────────────────────────

export interface Workflow {
  id: string;
  name: string;
  description: string | null;
  definition: { nodes: unknown[]; edges: unknown[] };
  enabled: boolean;
  createdBy: string | null;
  createdAt?: string;
  updatedAt?: string;
}

// Per-node execution event protocol (mirrors @openldr/workflows RunEvent on the server).
export type LogLevel = 'log' | 'info' | 'warn' | 'error';

export interface LogEntry {
  nodeId: string;
  level: LogLevel;
  message: string;
  ts: number;
}

export interface NodeRunResult {
  nodeId: string;
  type: string;
  status: 'success' | 'error' | 'skipped';
  output?: unknown;
  error?: string;
  durationMs: number;
  logs?: LogEntry[];
}

export interface ExecuteResponse {
  status: 'completed' | 'failed';
  startedAt: string;
  finishedAt: string;
  results: NodeRunResult[];
}

export type RunEvent =
  | { type: 'node:start'; nodeId: string; nodeType: string }
  | { type: 'node:log'; entry: LogEntry }
  | { type: 'node:success'; nodeId: string; nodeType: string; input: unknown; output: unknown; durationMs: number }
  | { type: 'node:error'; nodeId: string; nodeType: string; error: string; durationMs: number }
  | { type: 'workflow:done'; status: 'completed' | 'failed' };

export async function fetchWorkflows(): Promise<Workflow[]> {
  const res = await authFetch('/api/workflows');
  if (!res.ok) throw new Error(`workflows list failed: ${res.status}`);
  return res.json() as Promise<Workflow[]>;
}

export async function fetchWorkflow(id: string): Promise<Workflow> {
  const res = await authFetch(`/api/workflows/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(`workflow ${id} failed: ${res.status}`);
  return res.json() as Promise<Workflow>;
}

export async function createWorkflow(body: Omit<Workflow, 'createdAt' | 'updatedAt'>): Promise<Workflow> {
  const res = await authFetch('/api/workflows', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`create workflow failed: ${res.status}`);
  return res.json() as Promise<Workflow>;
}

export async function updateWorkflow(id: string, body: Omit<Workflow, 'createdAt' | 'updatedAt'>): Promise<Workflow> {
  const res = await authFetch(`/api/workflows/${encodeURIComponent(id)}`, {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`update workflow failed: ${res.status}`);
  return res.json() as Promise<Workflow>;
}

export async function deleteWorkflow(id: string): Promise<void> {
  const res = await authFetch(`/api/workflows/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`delete workflow failed: ${res.status}`);
}

/**
 * Stream execution events. `onEvent` receives each per-node RunEvent; the final
 * `event: done` frame carries the batch summary, which is returned to the caller
 * (mirrors the standalone `workflowApi.executeStream`). The `event: error` frame
 * throws.
 */
export async function executeWorkflowStream(
  id: string,
  onEvent: (evt: RunEvent) => void,
  opts: { input?: unknown; signal?: AbortSignal } = {},
): Promise<ExecuteResponse | null> {
  const token = getAccessToken();
  const res = await fetch(`/api/workflows/${encodeURIComponent(id)}/execute-stream`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ input: opts.input }),
    signal: opts.signal,
  });
  if (!res.ok || !res.body) throw new Error(`execute failed: ${res.status}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finalResult: ExecuteResponse | null = null;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split('\n\n');
    buffer = frames.pop() ?? '';
    for (const frame of frames) {
      let eventType = 'message';
      const dataLines: string[] = [];
      for (const l of frame.split('\n')) {
        if (l.startsWith('event:')) eventType = l.slice(6).trim();
        else if (l.startsWith('data:')) dataLines.push(l.slice(5).trim());
      }
      if (dataLines.length === 0) continue;
      let parsed: unknown;
      try { parsed = JSON.parse(dataLines.join('\n')); } catch { continue; /* skip malformed frame */ }
      if (eventType === 'done') {
        finalResult = parsed as ExecuteResponse;
      } else if (eventType === 'error') {
        const msg = parsed && typeof parsed === 'object' && 'message' in parsed
          ? String((parsed as { message: unknown }).message)
          : 'Stream error';
        throw new Error(msg);
      } else {
        onEvent(parsed as RunEvent);
      }
    }
  }
  return finalResult;
}

// ── Workflow run history ───────────────────────────────────────────────────────

export interface WorkflowRunSummary {
  id: string;
  workflowId: string;
  triggerSource: 'manual' | 'schedule' | 'webhook' | 'ingest';
  status: 'completed' | 'failed';
  startedAt: string;
  finishedAt: string;
  error: string | null;
  result: unknown;
}

export async function fetchWorkflowRuns(
  id: string,
  opts: { limit?: number; offset?: number } = {},
): Promise<WorkflowRunSummary[]> {
  const qs = new URLSearchParams();
  if (opts.limit != null) qs.set('limit', String(opts.limit));
  if (opts.offset != null) qs.set('offset', String(opts.offset));
  const res = await authFetch(`/api/workflows/${encodeURIComponent(id)}/runs${qs.toString() ? `?${qs}` : ''}`);
  if (!res.ok) throw new Error(`workflow runs failed: ${res.status}`);
  return res.json() as Promise<WorkflowRunSummary[]>;
}

export async function fetchWorkflowRun(runId: string): Promise<WorkflowRunSummary> {
  const res = await authFetch(`/api/workflows/runs/${encodeURIComponent(runId)}`);
  if (!res.ok) throw new Error(`workflow run failed: ${res.status}`);
  return res.json() as Promise<WorkflowRunSummary>;
}

export interface WorkflowDatasetSummary {
  name: string;
  rowCount: number;
  workflowId: string | null;
  updatedAt?: string;
  publishedTable?: string | null;
}

export async function fetchWorkflowDatasets(): Promise<WorkflowDatasetSummary[]> {
  const res = await authFetch('/api/workflows/datasets');
  if (!res.ok) throw new Error(`datasets failed: ${res.status}`);
  return res.json() as Promise<WorkflowDatasetSummary[]>;
}

// ── Connectors (SP-5b) ─────────────────────────────────────────────────────────
export interface Connector {
  id: string;
  name: string;
  pluginId: string;
  kind: string;
  allowedHost: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}
export interface SinkPluginRef { id: string; version: string; enabled: boolean }
export interface ConnectorMetadataCounts {
  dataElements: number; orgUnits: number; categoryOptionCombos: number; programs: number; programStages: number;
}
export type ConnectorTestResult =
  | { ok: true; metadata: ConnectorMetadataCounts }
  | { ok: false; error: string };
export interface ConnectorCreateInput {
  name: string; pluginId: string; config: Record<string, string>; allowedHost?: string;
}
export interface ConnectorUpdateInput {
  name?: string; config?: Record<string, string>; allowedHost?: string | null; enabled?: boolean;
}

export const listConnectors = (): Promise<Connector[]> =>
  apiGet<Connector[]>('/api/connectors', 'list connectors');
export const listSinkPlugins = (): Promise<SinkPluginRef[]> =>
  apiGet<SinkPluginRef[]>('/api/connectors/sink-plugins', 'list sink plugins');
export const createConnector = (input: ConnectorCreateInput): Promise<Connector> =>
  authFetch('/api/connectors', jbody(input, 'POST')).then((r) => okJson<Connector>(r, 'create connector'));
export const updateConnector = (id: string, input: ConnectorUpdateInput): Promise<Connector> =>
  authFetch(`/api/connectors/${encodeURIComponent(id)}`, jbody(input, 'PUT')).then((r) => okJson<Connector>(r, 'update connector'));
export const deleteConnector = (id: string): Promise<void> =>
  apiDelete(`/api/connectors/${encodeURIComponent(id)}`, 'delete connector');
export const testConnector = (id: string): Promise<ConnectorTestResult> =>
  authFetch(`/api/connectors/${encodeURIComponent(id)}/test`, { method: 'POST' }).then((r) => okJson<ConnectorTestResult>(r, 'test connector'));
