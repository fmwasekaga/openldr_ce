import { getAccessToken, notifyUnauthorized } from './auth/token';
import type { PluginBrokerOp, PluginRpcResult } from '@openldr/plugin-ui-sdk';
import type { ReportDesign } from '@openldr/report-designer/pure';

/** fetch wrapper that attaches the bearer token when one is present. */
export async function authFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const token = getAccessToken();
  let res: Response;
  if (!token) {
    res = init !== undefined ? await fetch(input, init) : await fetch(input);
  } else {
    const headers = new Headers(init?.headers);
    headers.set('Authorization', `Bearer ${token}`);
    res = await fetch(input, { ...init, headers });
  }
  // A 401 means the session expired or was invalidated (silent-renew failed / SSO ended). Notify
  // the auth layer to re-trigger login instead of surfacing raw "authentication required" errors
  // on every page/widget. Public endpoints (/api/config, /health) return 200, so this won't fire
  // during the pre-login bootstrap.
  if (res.status === 401) notifyUnauthorized();
  return res;
}

/** A report's category is a free-form id into the editable report-category list
 *  (see reports/reportCategoriesApi.ts). Was previously a hardcoded enum. */
export type ReportCategory = string;
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
  /** 'catalog' = built-in report; 'design' = a report record linking a report-designer template +
   *  query. Absent ⇒ catalog. */
  source?: 'catalog' | 'design';
  /** For source==='design': the linked report-designer template id, for the "Edit template" deep-link. */
  designId?: string;
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

export interface ConditionRule { kind: 'rule'; dimension: string; op: string; value: unknown }
export interface ConditionGroup { kind: 'group'; combinator: 'and' | 'or'; children: (ConditionRule | ConditionGroup)[] }

export type WidgetQuery =
  | { mode: 'builder'; model: string;
      metric: { key: string; label?: string; agg: string; column?: string; where?: { dimension: string; op: string; value: unknown }[]; derived?: { numerator: string; denominator: string; scale?: number; decimals?: number } };
      metrics?: { key: string; label?: string; agg: string; column?: string; where?: { dimension: string; op: string; value: unknown }[]; derived?: { numerator: string; denominator: string; scale?: number; decimals?: number } }[];
      dimension?: { key: string; grain?: string; reference?: string }; breakdown?: { key: string }; filters: { dimension: string; op: string; value: unknown }[];
      filterTree?: ConditionGroup;
      limit?: number;
      variableBindings?: Record<string, string> }
  | { mode: 'sql'; sql: string; variableBindings?: Record<string, string>; variables?: Record<string, WidgetVariableDef>;
      values?: Record<string, string | number | null | { from: string; to: string }> };

export interface WidgetConfig {
  id: string; type: string; title: string; query: WidgetQuery; refreshIntervalSec: number; visual: Record<string, unknown>;
}
export interface LayoutItem { i: string; x: number; y: number; w: number; h: number; minW?: number; minH?: number }
export interface DashboardFilterDef { id: string; label: string; type: 'text' | 'number' | 'date' | 'date-range'; defaultValue?: string | number | null; defaultRange?: { from: string; to: string } | null; options?: string[]; optionsSql?: string }
export interface Dashboard {
  id: string; ownerId: string | null; name: string; layout: LayoutItem[]; widgets: WidgetConfig[];
  filters: DashboardFilterDef[]; refreshIntervalSec: number; isDefault: boolean; createdAt?: string; updatedAt?: string;
}
export interface ModelDimension { key: string; label: string; column: string; kind: 'string' | 'date' | 'number'; dateGrain?: string[]; compute?: { kind: 'age-band'; bands: { maxAge: number; label: string }[]; openEndedLabel: string; unknownLabel: string }; join?: string }
export interface ModelMetric { key: string; label: string; agg: string; column?: string }
export interface QueryModel { id: string; label: string; dimensions: ModelDimension[]; metrics: ModelMetric[] }

const json = (body: unknown) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

export async function listModels(): Promise<QueryModel[]> {
  return authFetch('/api/dashboards/models').then((r) => okJson<QueryModel[]>(r, 'load models'));
}
export async function runWidgetQuery(q: WidgetQuery): Promise<ReportResult> {
  return authFetch('/api/dashboards/query', json(q)).then((r) => okJson<ReportResult>(r, 'run query'));
}
/** Builder→SQL eject: compile a builder-mode query to its SQL text (display-only; never executed as returned). */
export async function compileBuilderToSql(q: Extract<WidgetQuery, { mode: 'builder' }>): Promise<string> {
  return authFetch('/api/dashboards/compile-sql', json(q))
    .then((r) => okJson<{ sql: string }>(r, 'compile sql'))
    .then((x) => x.sql);
}
export async function listDashboards(): Promise<Dashboard[]> {
  return authFetch('/api/dashboards').then((r) => okJson<Dashboard[]>(r, 'list dashboards'));
}
export async function getDashboard(id: string): Promise<Dashboard> {
  return authFetch(`/api/dashboards/${id}`).then((r) => okJson<Dashboard>(r, 'get dashboard'));
}
export async function createDashboard(d: Dashboard): Promise<Dashboard> {
  return authFetch('/api/dashboards', json(d)).then((r) => okJson<Dashboard>(r, 'create dashboard'));
}
export async function saveDashboard(d: Dashboard): Promise<Dashboard> {
  return authFetch(`/api/dashboards/${d.id}`, { ...json(d), method: 'PUT' }).then((r) => okJson<Dashboard>(r, 'save dashboard'));
}
export async function deleteDashboard(id: string): Promise<void> {
  const r = await authFetch(`/api/dashboards/${id}`, { method: 'DELETE' }); if (!r.ok) throw new Error(`delete failed: ${r.status}`);
}

export interface OidcConfig { issuerUrl: string; clientId: string; audience: string | null }
export interface ClientConfig { dashboardSqlEnabled: boolean; authEnforced: boolean; version: string; environment: string; oidc: OidcConfig | null }
export async function fetchClientConfig(): Promise<ClientConfig> {
  const r = await authFetch('/api/config');
  if (!r.ok) return { dashboardSqlEnabled: false, authEnforced: false, version: '', environment: '', oidc: null };
  return r.json();
}

export interface FeatureFlag { id: string; labelKey: string; descriptionKey: string; value: boolean }

export const fetchFeatureFlags = (): Promise<FeatureFlag[]> =>
  authFetch('/api/settings/flags').then((r) => okJson<FeatureFlag[]>(r, 'list feature flags'));

export const setFeatureFlag = (key: string, value: boolean): Promise<{ key: string; value: boolean }> =>
  authFetch(`/api/settings/flags/${encodeURIComponent(key)}`, jbody({ value }, 'PUT'))
    .then((r) => okJson<{ key: string; value: boolean }>(r, 'set feature flag'));

export interface NumberSetting {
  id: string;
  labelKey: string;
  descriptionKey: string;
  value: number;
  min: number;
  max: number;
}

export const fetchNumberSettings = (): Promise<NumberSetting[]> =>
  authFetch('/api/settings/numbers').then((r) => okJson<NumberSetting[]>(r, 'list number settings'));

export const setNumberSetting = (key: string, value: number): Promise<{ key: string; value: number }> =>
  authFetch(`/api/settings/numbers/${encodeURIComponent(key)}`, jbody({ value }, 'PUT'))
    .then((r) => okJson<{ key: string; value: number }>(r, 'set number setting'));

// ── Lab ⇄ central sync (S4) ────────────────────────────────────────────────────
// Studio MIRRORS the server shapes: SyncConfigView/SyncConfigInput (@openldr/config)
// + SyncStatus/SyncDirectionStatus (@openldr/bootstrap sync-handle).
export type SyncMode = 'push' | 'pull' | 'bidirectional';
/** GET /api/settings/sync — never carries the secret value, only `clientSecretSet`. */
export interface SyncConfigView {
  enabled: boolean;
  mode: SyncMode;
  centralUrl: string;
  siteId: string;
  oidcIssuer: string;
  clientId: string;
  clientSecretSet: boolean;
  intervalMinutes: number;
  /** Whether a lab signing private key is stored (S5). Write-only: the value is never returned. */
  signingKeySet: boolean;
  /** Central's public key (DER hex), readable — a public key is not a secret (S5). */
  centralPublicKey: string;
}
/** PUT /api/settings/sync — `clientSecret` is WRITE-ONLY: omit it to preserve the stored value.
 *  `centralPublicKey` is OPTIONAL: omit it to preserve the enrollment-pinned key. */
export interface SyncConfigInput {
  enabled: boolean;
  mode: SyncMode;
  centralUrl: string;
  siteId: string;
  oidcIssuer: string;
  clientId: string;
  clientSecret?: string;
  intervalMinutes: number;
  centralPublicKey?: string;
}
export interface SyncDirectionStatus {
  running: boolean;
  lastSeq: number;
  lastSyncedAt: string | null;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
}
export interface SyncStatus {
  enabled: boolean;
  mode: SyncMode;
  centralUrl: string;
  siteId: string;
  push: SyncDirectionStatus | null;
  pull: SyncDirectionStatus | null;
  pendingPush: number;
}

export const fetchSyncConfig = (): Promise<SyncConfigView> =>
  authFetch('/api/settings/sync').then((r) => okJson<SyncConfigView>(r, 'load sync config'));

export const saveSyncConfig = (cfg: SyncConfigInput): Promise<SyncConfigView> =>
  authFetch('/api/settings/sync', jbody(cfg, 'PUT')).then((r) => okJson<SyncConfigView>(r, 'save sync config'));

export const fetchSyncStatus = (): Promise<SyncStatus> =>
  authFetch('/api/settings/sync/status').then((r) => okJson<SyncStatus>(r, 'sync status'));

export interface SyncActivityRow {
  id: string;
  occurredAt: string;
  direction: 'push' | 'pull' | 'amend';
  event: 'synced' | 'failed' | 'quarantined' | 'diverged';
  records: number;
  error: string | null;
  metadata: Record<string, unknown> | null;
}

export const fetchSyncActivity = (): Promise<SyncActivityRow[]> =>
  authFetch('/api/settings/sync/activity').then((r) => okJson<SyncActivityRow[]>(r, 'sync activity'));

/** POST /api/settings/sync/now. Returns 409 `{triggered:false,reason:'disabled'}` when sync is off —
 *  surface that as a result rather than an error so the caller can show an info toast. */
export async function triggerSyncNow(): Promise<{ triggered: boolean; reason?: string }> {
  const r = await authFetch('/api/settings/sync/now', jbody({}, 'POST'));
  if (r.status === 409) return r.json() as Promise<{ triggered: boolean; reason?: string }>;
  return okJson<{ triggered: boolean; reason?: string }>(r, 'sync now');
}

// ── Central enrollment (sync S4d) ──────────────────────────────────────────────
// Studio MIRRORS the server shapes: EnrollResult (@openldr/bootstrap enrollment) +
// SyncSiteRow (@openldr/db sync-site-store). The clientSecret is returned ONLY by
// enroll/rotate and is NEVER re-fetchable — GET /sites carries no secret.
export interface SyncSiteRow {
  siteId: string;
  name: string | null;
  clientId: string;
  enrolledAt: string;
  enrolledBy: string | null;
  status: 'active' | 'revoked';
}
export interface EnrollResult {
  clientId: string;
  clientSecret: string;
  siteId: string;
  centralUrl: string;
  oidcIssuer: string;
}

/** Build an Error that carries the HTTP status so the caller can map 400/404/409/503 to a
 *  precise toast instead of the raw server message. */
async function statusError(res: Response, what: string): Promise<Error & { status: number }> {
  return Object.assign(new Error(formatApiError(what, await errorDetail(res))), { status: res.status });
}

export const fetchSites = (): Promise<SyncSiteRow[]> =>
  authFetch('/api/settings/sync/sites').then((r) => okJson<SyncSiteRow[]>(r, 'list sites'));

export async function enrollSite(body: { siteId: string; name?: string; centralUrl: string }): Promise<EnrollResult> {
  const res = await authFetch('/api/settings/sync/enroll', jbody(body, 'POST'));
  if (!res.ok) throw await statusError(res, 'enroll site');
  return res.json() as Promise<EnrollResult>;
}

export async function rotateSite(siteId: string): Promise<{ clientId: string; clientSecret: string }> {
  const res = await authFetch(`/api/settings/sync/sites/${encodeURIComponent(siteId)}/rotate`, jbody({}, 'POST'));
  if (!res.ok) throw await statusError(res, 'rotate site');
  return res.json() as Promise<{ clientId: string; clientSecret: string }>;
}

export async function revokeSite(siteId: string): Promise<{ revoked: boolean }> {
  const res = await authFetch(`/api/settings/sync/sites/${encodeURIComponent(siteId)}/revoke`, jbody({}, 'POST'));
  if (!res.ok) throw await statusError(res, 'revoke site');
  return res.json() as Promise<{ revoked: boolean }>;
}

export async function downloadCentralCertificate(): Promise<void> {
  const res = await authFetch('/api/settings/sync/central-certificate');
  if (!res.ok) throw Object.assign(new Error('cert download failed'), { status: res.status });
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'central-certificate.pem';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export type DangerAction = 'reset-dashboards' | 'factory-reset' | 'clear-audit';

export const runDangerAction = (action: DangerAction): Promise<{ ok: boolean; action: string }> =>
  authFetch(`/api/settings/danger/${action}`, jbody({}, 'POST'))
    .then((r) => okJson<{ ok: boolean; action: string }>(r, `danger:${action}`));

// ── FHIR validation strictness (Danger Zone) ───────────────────────────────────
export type ValidationStrictness = 'low' | 'medium' | 'high';

export const getValidation = (): Promise<{ strictness: ValidationStrictness }> =>
  authFetch('/api/settings/validation').then((r) => okJson<{ strictness: ValidationStrictness }>(r, 'get validation strictness'));

export const setValidation = (strictness: ValidationStrictness): Promise<{ strictness: ValidationStrictness }> =>
  authFetch('/api/settings/validation', jbody({ strictness }, 'PUT'))
    .then((r) => okJson<{ strictness: ValidationStrictness }>(r, 'set validation strictness'));

export interface HealthCheckResult { status: string; latencyMs: number; detail?: string }
export interface HealthReport { status: string; checks: Record<string, HealthCheckResult> }
export const fetchHealth = (): Promise<HealthReport> =>
  authFetch('/health').then((r) => r.json() as Promise<HealthReport>);

// Audit
export interface AuditEvent {
  id: string;
  occurredAt: string;
  actorType: 'user' | 'system' | 'cli';
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

// ── Report designs (Report Designer) ─────────────────────────────────────────
export const listReportDesigns = (): Promise<ReportDesign[]> =>
  authFetch('/api/report-designs').then((r) => okJson<ReportDesign[]>(r, 'list report designs'));
export const getReportDesign = (id: string): Promise<ReportDesign> =>
  apiGet(`/api/report-designs/${encodeURIComponent(id)}`, 'get report design');
export const createReportDesign = (d: ReportDesign): Promise<ReportDesign> =>
  authFetch('/api/report-designs', jbody(d, 'POST')).then((r) => okJson<ReportDesign>(r, 'create report design'));
export const updateReportDesign = (id: string, d: ReportDesign): Promise<ReportDesign> =>
  authFetch(`/api/report-designs/${encodeURIComponent(id)}`, jbody(d, 'PUT')).then((r) => okJson<ReportDesign>(r, 'save report design'));
export const deleteReportDesign = (id: string): Promise<void> =>
  apiDelete(`/api/report-designs/${encodeURIComponent(id)}`, 'delete report design');
export const previewReportDesign = (design: ReportDesign): Promise<Blob> =>
  authFetch('/api/report-designs/preview', jbody(design, 'POST')).then((r) => {
    if (!r.ok) throw new Error(`preview failed: ${r.status}`);
    return r.blob();
  });

/** Render the (working) design via the preview endpoint and download it as a PDF file. */
export async function downloadReportDesignPdf(design: ReportDesign): Promise<void> {
  const blob = await previewReportDesign(design);
  const safeName = (design.name || 'report-design').replace(/[^\w.-]+/g, '_');
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${safeName}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
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
interface ApiErrorDetail { message: string; code?: string; correlationId?: string }

async function errorDetail(res: Response): Promise<ApiErrorDetail> {
  const contentType = res.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    const body = await res.json().catch(() => null) as { error?: unknown; message?: unknown; code?: unknown; correlationId?: unknown } | null;
    const detail = body?.error ?? body?.message;
    const message = typeof detail === 'string' && detail.trim() ? detail.trim() : String(res.status);
    return {
      message,
      code: typeof body?.code === 'string' ? body.code : undefined,
      correlationId: typeof body?.correlationId === 'string' ? body.correlationId : undefined,
    };
  }
  const text = await res.text().catch(() => '');
  return { message: text.trim() || String(res.status) };
}

/** Format a failed API call into a single user-facing string: "<what> failed: <message> · <code> · <id>". */
export function formatApiError(what: string, detail: ApiErrorDetail): string {
  const parts = [detail.message];
  if (detail.code) parts.push(detail.code);
  if (detail.correlationId) parts.push(detail.correlationId);
  return `${what} failed: ${parts.join(' · ')}`;
}

async function okJson<T>(res: Response, what: string): Promise<T> {
  if (!res.ok) throw new Error(formatApiError(what, await errorDetail(res)));
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
  const r = await authFetch(`/api/terminology/systems/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!r.ok && r.status !== 204) {
    let msg = `delete system failed: ${r.status}`;
    try { const j = await r.json(); if (j?.error) msg = j.error; } catch { /* keep status fallback */ }
    throw new Error(msg);
  }
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

export interface TerminologyIngestJobView {
  id: string; status: 'queued' | 'running' | 'ready' | 'failed';
  phase: string | null; processed: number; total: number | null; error: string | null;
  version: string | null; finishedAt: string | null;
}

/** Stream a distribution zip to the server with upload progress. Uses XHR (fetch has no upload
 *  progress). Auth mirrors authFetch: bearer from getAccessToken(). */
export function uploadTerminologyDistribution(
  publisherId: string, systemType: string, file: File, acceptLicense: boolean, version: string | null,
  onProgress?: (fraction: number) => void,
): Promise<{ jobId: string }> {
  return new Promise((resolve, reject) => {
    const params = new URLSearchParams({ systemType, acceptLicense: String(acceptLicense) });
    if (version) params.set('version', version);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/terminology/publishers/${encodeURIComponent(publisherId)}/distribution?${params.toString()}`);
    xhr.setRequestHeader('content-type', 'application/octet-stream');
    const token = getAccessToken();
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total); };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try { resolve(JSON.parse(xhr.responseText)); } catch { resolve({ jobId: '' }); }
      } else {
        let msg = `upload failed (${xhr.status})`;
        try { const j = JSON.parse(xhr.responseText); if (j?.error) msg = j.error; } catch { /* ignore */ }
        reject(new Error(msg));
      }
    };
    xhr.onerror = () => reject(new Error('network error during upload'));
    xhr.send(file);
  });
}

export const getTerminologyIngestJob = (publisherId: string, systemType: string): Promise<TerminologyIngestJobView> =>
  authFetch(`/api/terminology/publishers/${encodeURIComponent(publisherId)}/distribution/job?systemType=${systemType}`)
    .then((r) => okJson<TerminologyIngestJobView>(r, 'get import job'));

export const purgeTerminologyDistribution = (publisherId: string, systemType: string): Promise<void> =>
  authFetch(`/api/terminology/publishers/${encodeURIComponent(publisherId)}/distribution?systemType=${systemType}`, { method: 'DELETE' }).then(() => undefined);

/** Rebuild an upload-managed coding system by re-ingesting its retained distribution zip from the
 *  blob store (concepts + ontology). Returns the queued job id; progress flows through the same
 *  job-status poll + bell as an upload. */
export const reingestTerminologyDistribution = (codingSystemId: string): Promise<{ jobId: string }> =>
  authFetch(`/api/terminology/systems/${encodeURIComponent(codingSystemId)}/distribution/reingest`, { method: 'POST' })
    .then((r) => okJson<{ jobId: string }>(r, 'rebuild distribution'));

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
  /** When valid === false, the specific check that failed (so the UI shows the real cause). */
  invalidReason?: 'fingerprint-mismatch' | 'payload-hash-mismatch' | 'ui-hash-mismatch' | 'bad-signature';
  description?: string;
  license?: string;
  summary?: string;
  signatureFingerprint?: string;
  versions?: { version: string; ref: string }[];
  registryName?: string;
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
  description?: string | null;
  license?: string | null;
  payload?: ArtifactPayloadMeta | null;
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

/** Rich detail for an installed plugin (readme/payload/compatibility), read from its
 *  stored manifest — the installed analogue of getAvailableArtifact. */
export interface InstalledArtifactDetail {
  id: string;
  version: string;
  type: string;
  publisher: { id: string; name: string } | null;
  description?: string | null;
  readme?: string;
  license?: string | null;
  payload?: ArtifactPayloadMeta | null;
  capabilities: unknown[];
  compatible: boolean;
  ceVersion: string;
  compatibility?: { ceVersion: string };
  valid?: boolean;
  invalidReason?: AvailableArtifact['invalidReason'];
}

export const getInstalledArtifact = (id: string): Promise<InstalledArtifactDetail> =>
  apiGet(`/api/marketplace/installed/${encodeURIComponent(id)}`, 'get installed artifact');

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

// ── Marketplace registries (SP-C) ──────────────────────────────────────────────
export interface MarketplaceRegistry { id: string; name: string; kind: 'local' | 'http'; location: string; enabled: boolean; createdAt: string; updatedAt: string }
export interface RegistryInput { name: string; kind: 'local' | 'http'; location: string; enabled?: boolean }
export const listRegistries = (): Promise<MarketplaceRegistry[]> => apiGet('/api/marketplace/registries', 'list registries');
export const createRegistry = (i: RegistryInput): Promise<MarketplaceRegistry> => authFetch('/api/marketplace/registries', jbody(i, 'POST')).then((r) => okJson<MarketplaceRegistry>(r, 'create registry'));
export const updateRegistry = (id: string, i: Partial<RegistryInput>): Promise<MarketplaceRegistry> => authFetch(`/api/marketplace/registries/${encodeURIComponent(id)}`, jbody(i, 'PUT')).then((r) => okJson<MarketplaceRegistry>(r, 'update registry'));
export async function deleteRegistry(id: string): Promise<void> { const r = await authFetch(`/api/marketplace/registries/${encodeURIComponent(id)}`, { method: 'DELETE' }); if (!r.ok && r.status !== 204) throw new Error(`delete registry failed: ${r.status}`); }

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

// ── Workflow node catalog (plugin-contributed + host) ──────────────────────────
export interface WorkflowNodeConfigField {
  key: string;
  label: string;
  type: 'text' | 'number' | 'boolean' | 'select' | 'multiselect' | 'file' | 'json';
  required?: boolean;
  default?: unknown;
  options?: { value: string; label: string }[];
  optionsSource?: string;
  detailSource?: string;
}
export interface WorkflowNodeDescriptor {
  id: string;                 // composite `${pluginId}:${declId}` for plugin nodes
  source: 'host' | 'plugin';
  pluginId?: string;
  label: string;
  kind: 'source' | 'transform' | 'sink';
  description: string;
  entrypoint?: string;
  ports: { inputs: { name: string }[]; outputs: { name: string }[] };
  capabilities: string[];
  config: WorkflowNodeConfigField[];
  /** Wire ABI for plugin nodes: 'items' = JSON {items,config} (default); 'bytes' = raw binary. */
  abi?: 'items' | 'bytes';
  /** For abi:'bytes' — the binary field name on the trigger item (default 'file'). */
  binaryField?: string;
}
export interface WorkflowNodeOption { value: string; label: string }

export async function fetchWorkflowNodes(): Promise<WorkflowNodeDescriptor[]> {
  const r = await authFetch('/api/workflows/nodes');
  if (!r.ok) throw new Error(`workflow nodes failed: ${r.status}`);
  const body = (await r.json()) as { nodes: WorkflowNodeDescriptor[] };
  return body.nodes;
}
export async function fetchNodeOptions(source: string, pluginId?: string): Promise<WorkflowNodeOption[]> {
  const q = pluginId ? `?pluginId=${encodeURIComponent(pluginId)}` : '';
  const r = await authFetch(`/api/workflows/node-options/${encodeURIComponent(source)}${q}`);
  if (!r.ok) return [];
  return (await r.json()) as WorkflowNodeOption[];
}
export async function fetchNodeDetail(source: string, value: string): Promise<Record<string, unknown>> {
  const r = await authFetch(`/api/workflows/node-detail/${encodeURIComponent(source)}?value=${encodeURIComponent(value)}`);
  if (!r.ok) return {};
  return (await r.json()) as Record<string, unknown>;
}
/** The bare decl id for a plugin descriptor (strip the `${pluginId}:` prefix). */
export function pluginNodeDeclId(d: WorkflowNodeDescriptor): string {
  return d.pluginId && d.id.startsWith(`${d.pluginId}:`) ? d.id.slice(d.pluginId.length + 1) : d.id;
}

/** A server-side binary reference returned by the upload endpoint. */
export interface WorkflowBinaryRef {
  objectKey: string;
  contentType: string;
  fileName?: string;
  byteSize: number;
}

/**
 * Upload a file as an octet-stream body, scoped to a specific workflow.
 * Returns a `WorkflowBinaryRef` that can be passed to `executeWorkflowStream`
 * as a `files` entry so the engine seeds it onto the trigger item.
 */
export async function uploadWorkflowFile(workflowId: string, file: File): Promise<WorkflowBinaryRef> {
  const r = await authFetch(
    `/api/workflows/${encodeURIComponent(workflowId)}/uploads?filename=${encodeURIComponent(file.name)}`,
    { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: file },
  );
  if (!r.ok) throw new Error(`upload failed: ${r.status}`);
  return r.json() as Promise<WorkflowBinaryRef>;
}

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

/**
 * An opaque reference to a server-side workflow secret (SEC-06). The detail
 * fetch (`GET /api/workflows/:id`) returns these in place of plaintext secrets
 * (webhook `data.secret`, HTTP node `data.config.headers`) — the value is
 * write-only, so the builder shows a masked "secret is set" state and round-trips
 * an untouched ref back unchanged on save. Mirrors `SecretValue` in
 * `@openldr/workflows` (secret-fields.ts).
 */
export type SecretRef = { secretRef: string };

/** A secret field value: plaintext (new/edited) or an opaque store reference (unchanged). */
export type SecretValue = string | SecretRef;

/** Type guard: is this value an opaque secret-store reference (vs. plaintext)? */
export function isSecretRef(v: unknown): v is SecretRef {
  return !!v && typeof v === 'object' && typeof (v as { secretRef?: unknown }).secretRef === 'string';
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
  label?: string;
  status: 'success' | 'error' | 'skipped';
  output?: unknown;
  /** Structured result metadata (e.g. a plugin sink's import summary). Undefined for most nodes. */
  meta?: unknown;
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
  | { type: 'node:success'; nodeId: string; nodeType: string; input: unknown; output: unknown; durationMs: number; meta?: unknown }
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
  opts: { input?: unknown; signal?: AbortSignal; files?: Record<string, WorkflowBinaryRef> } = {},
): Promise<ExecuteResponse | null> {
  const token = getAccessToken();
  const body: Record<string, unknown> = { input: opts.input };
  if (opts.files) body.files = opts.files;
  const res = await fetch(`/api/workflows/${encodeURIComponent(id)}/execute-stream`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
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
  triggerSource: 'manual' | 'schedule' | 'webhook' | 'ingest' | 'event';
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
  pluginId: string | null;
  type: string | null;
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
  | { ok: true; metadata?: ConnectorMetadataCounts }
  | { ok: false; error: string };
export interface ConnectorCreateInput {
  name: string; pluginId?: string; type?: string; config: Record<string, string>; allowedHost?: string;
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

/** Authenticated download of a produced workflow artifact (objectKey under workflow-artifacts/). */
export async function downloadWorkflowArtifact(objectKey: string, fileName: string): Promise<void> {
  const path = objectKey.split('/').map(encodeURIComponent).join('/');
  const r = await authFetch(`/api/workflows/artifacts/${path}`);
  if (!r.ok) throw new Error(`download failed: ${r.status}`);
  const blob = await r.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = fileName;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

// ── Payload lifecycle activity (S4) ────────────────────────────────────────────
export interface LifecycleStageEntry { stage: string; status: string; at: string; runId?: string; detail?: string }
export interface Lifecycle { correlationId: string; status: string; stages: LifecycleStageEntry[]; runIds: string[] }
export interface RecentPayload { correlationId: string; workflowId: string; source: string | null; startedAt: string; currentStage: string; status: string }

export const fetchActivity = (limit = 200): Promise<RecentPayload[]> =>
  authFetch(`/api/activity?limit=${limit}`).then((r) => okJson<RecentPayload[]>(r, 'list activity'));
export const fetchLifecycle = (id: string): Promise<Lifecycle> =>
  authFetch(`/api/activity/${encodeURIComponent(id)}`).then((r) => okJson<Lifecycle>(r, 'load lifecycle'));

// ── Plugin UI surface (SP-A1b) ─────────────────────────────────────────────────

export interface PluginUiEntry {
  id: string;
  version: string;
  nav: { label: string; icon: string; section: string };
  uiSdkVersion: string;
  hasWebview: boolean;
  hasDeclarative: boolean;
  declarative: unknown | null;
}

export const listPluginUis = (): Promise<PluginUiEntry[]> =>
  apiGet<PluginUiEntry[]>('/api/plugins/ui', 'list plugin UIs');

export const pluginUiAssetUrl = (id: string): string => `/api/plugins/${encodeURIComponent(id)}/ui/asset`;

export const pluginBrokerCall = (id: string, op: PluginBrokerOp): Promise<PluginRpcResult> =>
  authFetch(`/api/plugins/${encodeURIComponent(id)}/broker`, jbody({ op }, 'POST'))
    .then((r) => okJson<PluginRpcResult>(r, 'plugin broker call'));

// ── Notifications (bell) ────────────────────────────────────────────────────

export type NotificationPriority = 'info' | 'warning' | 'critical';
export type NotificationType =
  | 'sync_diverged' | 'sync_failed' | 'sync_quarantined'
  | 'plugin_crashed' | 'system_crashed' | 'auth_failed' | 'site_revoked'
  | 'terminology_import_done' | 'terminology_import_failed';

export interface Notification {
  id: string;
  type: NotificationType;
  priority: NotificationPriority;
  title: string;
  body: string | null;
  linkTo: string | null;
  createdAt: string;
  readAt: string | null;
  metadata: Record<string, unknown> | null;
}

export interface NotificationListParams {
  limit?: number; offset?: number; unreadOnly?: boolean; type?: string; priority?: string;
}

export async function listNotifications(
  params: NotificationListParams = {},
): Promise<{ notifications: Notification[]; unreadCount: number; total: number }> {
  const qs = new URLSearchParams();
  if (params.limit != null) qs.set('limit', String(params.limit));
  if (params.offset != null) qs.set('offset', String(params.offset));
  if (params.unreadOnly) qs.set('unreadOnly', 'true');
  if (params.type) qs.set('type', params.type);
  if (params.priority) qs.set('priority', params.priority);
  const res = await authFetch(`/api/notifications?${qs.toString()}`);
  if (!res.ok) throw new Error(`notifications list failed: ${res.status}`);
  return res.json() as Promise<{ notifications: Notification[]; unreadCount: number; total: number }>;
}

export async function markNotificationsRead(ids: string[]): Promise<void> {
  await authFetch('/api/notifications/read', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }),
  });
}

export async function markAllNotificationsRead(): Promise<void> {
  await authFetch('/api/notifications/read-all', { method: 'POST' });
}

export async function getNotificationPrefs(): Promise<{ disabled: string[]; minPriority: NotificationPriority }> {
  const res = await authFetch('/api/notifications/preferences');
  if (!res.ok) return { disabled: [], minPriority: 'info' };
  return res.json() as Promise<{ disabled: string[]; minPriority: NotificationPriority }>;
}

export async function saveNotificationPrefs(
  prefs: { type: string; enabled: boolean }[], minPriority?: NotificationPriority,
): Promise<void> {
  const res = await authFetch('/api/notifications/preferences', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prefs, minPriority }),
  });
  if (!res.ok) throw new Error('save preferences failed: ' + res.status);
}
