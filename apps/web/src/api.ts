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
}
export interface CreateUserInput {
  username: string;
  displayName?: string | null;
  email?: string | null;
  roles?: string[];
}
export const USER_ROLES = ['lab_admin', 'lab_manager', 'lab_technician', 'data_analyst', 'system_auditor'] as const;
export const listUsers = (): Promise<User[]> => apiGet('/api/users', 'list users');
export const createUser = (i: CreateUserInput): Promise<User> =>
  fetch('/api/users', jbody(i, 'POST')).then((r) => okJson<User>(r, 'create user'));
export const updateUser = (id: string, i: { displayName?: string | null; email?: string | null; roles?: string[] }): Promise<User> =>
  fetch(`/api/users/${id}`, jbody(i, 'PUT')).then((r) => okJson<User>(r, 'update user'));
export const setUserStatus = (id: string, status: 'active' | 'disabled'): Promise<User> =>
  fetch(`/api/users/${id}/status`, jbody({ status }, 'POST')).then((r) => okJson<User>(r, 'set user status'));

// Forms
export type FormStatus = 'draft' | 'published' | 'archived';
export interface FormSummary {
  id: string;
  name: string;
  versionLabel: string | null;
  status: FormStatus;
  active: boolean;
  fhirResourceType: string | null;
  fieldCount: number;
  updatedAt: string;
}
export interface FormDefinition {
  id: string;
  name: string;
  versionLabel: string | null;
  fhirResourceType: string | null;
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
  fetch('/api/forms', jbody(i, 'POST')).then((r) => okJson<FormDefinition>(r, 'create form'));
export const updateForm = (id: string, i: UpdateFormInput): Promise<FormDefinition> =>
  fetch(`/api/forms/${id}`, jbody(i, 'PUT')).then((r) => okJson<FormDefinition>(r, 'update form'));
export const publishForm = (id: string, i: PublishFormInput = {}): Promise<FormDefinition> =>
  fetch(`/api/forms/${id}/publish`, jbody(i, 'POST')).then((r) => okJson<FormDefinition>(r, 'publish form'));
export const duplicateForm = (id: string): Promise<FormDefinition> =>
  fetch(`/api/forms/${id}/duplicate`, jbody({}, 'POST')).then((r) => okJson<FormDefinition>(r, 'duplicate form'));
export const listFormVersions = (id: string): Promise<FormVersionSummary[]> =>
  apiGet(`/api/forms/${id}/versions`, 'list form versions');
export const getFormVersion = (id: string, version: number): Promise<FormVersion> =>
  apiGet(`/api/forms/${id}/versions/${version}`, 'get form version');
export const setFormStatus = (id: string, status: FormStatus): Promise<FormDefinition> =>
  fetch(`/api/forms/${id}/status`, jbody({ status }, 'POST')).then((r) => okJson<FormDefinition>(r, 'set form status'));
export const deleteForm = (id: string): Promise<void> => apiDelete(`/api/forms/${id}`, 'delete form');
export const formQuestionnaireUrl = (id: string): string => `/api/forms/${id}/questionnaire`;
export const submitFormResponse = (id: string, answers: unknown): Promise<unknown> =>
  fetch(`/api/forms/${id}/responses`, jbody({ answers }, 'POST')).then((r) => okJson<unknown>(r, 'submit form response'));

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
const apiGet = <T>(url: string, what: string): Promise<T> => fetch(url).then((res) => okJson<T>(res, what));
async function apiDelete(url: string, what: string): Promise<void> {
  const res = await fetch(url, { method: 'DELETE' });
  if (!res.ok && res.status !== 204) throw new Error(`${what} failed: ${res.status}`);
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
  fetch(`/api/terminology/valuesets${publisherId ? `?publisherId=${encodeURIComponent(publisherId)}` : ''}`).then((r) => okJson<ValueSetSummary[]>(r, 'list value sets'));
export const getValueSet = (id: string): Promise<ValueSet> => fetch(`/api/terminology/valuesets/${id}`).then((r) => okJson<ValueSet>(r, 'get value set'));
export const saveValueSet = (input: ValueSetInput): Promise<ValueSet> => fetch('/api/terminology/valuesets', jbody(input, 'POST')).then((r) => okJson<ValueSet>(r, 'save value set'));
export async function deleteValueSet(id: string): Promise<void> {
  const r = await fetch(`/api/terminology/valuesets/${id}`, { method: 'DELETE' });
  if (!r.ok && r.status !== 204) throw new Error(`delete value set failed: ${r.status}`);
}
export const duplicateValueSet = (id: string): Promise<ValueSet> => fetch(`/api/terminology/valuesets/${id}/duplicate`, jbody({}, 'POST')).then((r) => okJson<ValueSet>(r, 'duplicate value set'));
export const expandValueSet = (id: string, activeOnly = true): Promise<{ codes: ExpandedCode[]; total: number }> =>
  fetch(`/api/terminology/valuesets/${id}/expand?activeOnly=${activeOnly}`).then((r) => okJson<{ codes: ExpandedCode[]; total: number }>(r, 'expand value set'));
export const importValueSet = (resource: unknown | Blob): Promise<ValueSet | ValueSetCatalogImportResult> => {
  const init = resource instanceof Blob
    ? {
      method: 'POST',
      headers: { 'content-type': 'name' in resource && typeof resource.name === 'string' && resource.name.endsWith('.gz') ? 'application/gzip' : 'application/fhir+json' },
      body: resource,
    }
    : jbody(resource, 'POST');
  return fetch('/api/terminology/valuesets/import', init).then((r) => okJson<ValueSet | ValueSetCatalogImportResult>(r, 'import value set'));
};
export const valueSetExportUrl = (id: string): string => `/api/terminology/valuesets/${id}/export`;
export const importLoincDistribution = (path: string, acceptLicense: boolean): Promise<TerminologyLoadResult> =>
  fetch('/api/terminology/import/loinc', jbody({ path, acceptLicense }, 'POST')).then((r) => okJson<TerminologyLoadResult>(r, 'import LOINC distribution'));

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
  return fetch(`/api/terminology/systems/${systemId}/terms?${qs}`).then((r) => okJson<{ rows: Term[]; total: number }>(r, 'search terms'));
};
export const createTerm = (systemId: string, i: TermInput) => fetch(`/api/terminology/systems/${systemId}/terms`, jbody(i, 'POST')).then((r) => okJson<Term>(r, 'create term'));
export const updateTerm = (systemId: string, code: string, i: TermInput) => fetch(`/api/terminology/systems/${systemId}/terms/${encodeURIComponent(code)}`, jbody(i, 'PUT')).then((r) => okJson<Term>(r, 'update term'));
export async function deleteTerm(systemId: string, code: string): Promise<void> {
  const r = await fetch(`/api/terminology/systems/${systemId}/terms/${encodeURIComponent(code)}`, { method: 'DELETE' });
  if (!r.ok && r.status !== 204) throw new Error(`delete term failed: ${r.status}`);
}
export const importTerms = (systemId: string, source: string | Blob) => {
  const init = source instanceof Blob
    ? { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: source }
    : jbody({ text: source }, 'POST');
  return fetch(`/api/terminology/systems/${systemId}/terms/import`, init).then((r) => okJson<{ imported: number }>(r, 'import terms'));
};
export const termsTemplateUrl = (systemId: string) => `/api/terminology/systems/${systemId}/terms/template.csv`;

export const listTermMappings = (system: string, code: string) =>
  fetch(`/api/terminology/terms/${encodeURIComponent(system)}/${encodeURIComponent(code)}/mappings`).then((r) => okJson<{ outgoing: TermMapping[]; reverse: TermMapping[] }>(r, 'list mappings'));
export const createTermMapping = (system: string, code: string, i: Omit<TermMappingInput, 'fromSystem' | 'fromCode'>) =>
  fetch(`/api/terminology/terms/${encodeURIComponent(system)}/${encodeURIComponent(code)}/mappings`, jbody(i, 'POST')).then((r) => okJson<{ mapping: TermMapping; draftCreated: boolean }>(r, 'create mapping'));
export const updateTermMapping = (id: string, i: TermMappingInput) => fetch(`/api/terminology/mappings/${id}`, jbody(i, 'PUT')).then((r) => okJson<TermMapping>(r, 'update mapping'));
export async function deleteTermMapping(id: string): Promise<void> {
  const r = await fetch(`/api/terminology/mappings/${id}`, { method: 'DELETE' });
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

export function buildOntology(
  id: string,
  opts: { path?: string; rebuild?: boolean },
  onProgress: (progress: OntologyBuildProgress) => void,
): { promise: Promise<OntologyDistribution>; cancel: () => void } {
  const url = opts.rebuild
    ? `/api/terminology/ontology/${id}/rebuild`
    : `/api/terminology/ontology/${id}/build?path=${encodeURIComponent(opts.path ?? '')}`;
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
