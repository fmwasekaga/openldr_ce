import { Kysely } from 'kysely';
import { createAuth } from '@openldr/adapter-auth';
import { createEventBus } from '@openldr/adapter-event-bus';
import { createS3Bucket } from '@openldr/adapter-s3-bucket';
import type { Config } from '@openldr/config';
import { createLogger, HealthRegistry, redact, type Logger } from '@openldr/core';
import { createInternalDb, createFhirStore, createTerminologyStore, createTerminologyAdminStore, createOntologyStore, createReportRunStore, createReportScheduleStore, deriveSystemCode, resolveSeedPublisherId, type TerminologyAdminStore, type OntologyStore, type FhirStore, type ReportRunStore, type ReportScheduleStore } from '@openldr/db';
import type { ExternalSchema, InternalSchema } from '@openldr/db';
import type { AuthPort, BlobStoragePort, EventingPort, TargetStorePort } from '@openldr/ports';
import { createAuditStore, type AuditStore } from '@openldr/audit';
import { createUserStore, type UserStore, createUserProfileStore, type UserProfileStore } from '@openldr/users';
import { createFormStore, type FormStore } from '@openldr/forms';
import { getReport, reportSummaries, getEventSource, eventSourceCatalog, type ReportResult, type ReportSummary } from '@openldr/reporting';
import { createDashboardStore, getModel, listModels, runBuilderQuery, runSqlQuery, type DashboardStore, type WidgetQuery } from '@openldr/dashboards';
import {
  createWorkflowStore, type WorkflowStore,
  createWorkflowRunStore, type WorkflowRunStore,
  createWorkflowScheduleStore, type WorkflowScheduleStore,
  createWebhookRegistry, type WebhookRegistry,
  createWorkflowTriggerRunner, type WorkflowTriggerRunner,
  runWorkflow,
} from '@openldr/workflows';
import { renderReportPdf } from '@openldr/report-pdf';
import { createReportScheduler, type ReportScheduler } from './report-scheduler';
import { type PluginRuntime } from '@openldr/plugins';
import { selectTargetStore } from './target-store';
import { createPluginRegistry } from './plugin-registry';
import { buildOntologyDistribution, createOperations, importTerminologyResource, loadLoinc, loadWhonetAmr, stalenessReason, type LoaderStore, type LoadResult, type OntologyBuildProgress, type OntologyManifest, type Operations } from '@openldr/terminology';

export class ReportNotFoundError extends Error {
  constructor(public readonly id: string) {
    super(`unknown report: ${id}`);
    this.name = 'ReportNotFoundError';
  }
}

export class DashboardQueryError extends Error {
  constructor(msg: string) { super(msg); this.name = 'DashboardQueryError'; }
}

export interface DashboardsApi {
  store: DashboardStore;
  models(): ReturnType<typeof listModels>;
  query(q: WidgetQuery): Promise<ReportResult>;
}

export interface ReportingApi {
  list(): ReportSummary[];
  run(id: string, rawParams: unknown): Promise<ReportResult>;
  runEventSource(id: string, window: { from: string; to: string }): Promise<{ rows: Record<string, unknown>[] }>;
  eventSources(): { id: string; name: string; columns: { key: string; label: string }[] }[];
  renderPdf(id: string, rawParams: unknown): Promise<Buffer>;
  options(id: string): Promise<Record<string, string[]>>;
}

function createOntologyApi(ontologyStore: OntologyStore) {
  return {
    listDistributions: () => ontologyStore.list(),
    async getDistribution(systemId: string) {
      const distribution = await ontologyStore.get(systemId);
      return distribution ? { ...distribution, stale: stalenessReason(distribution.manifest as OntologyManifest | null) !== null } : null;
    },
    build: (systemId: string, sourcePath: string, onProgress: (progress: OntologyBuildProgress) => void) =>
      buildOntologyDistribution(systemId, sourcePath, ontologyStore, onProgress),
    async rebuild(systemId: string, onProgress: (progress: OntologyBuildProgress) => void) {
      const distribution = await ontologyStore.get(systemId);
      if (!distribution) throw new Error('No distribution linked.');
      return buildOntologyDistribution(systemId, distribution.sourcePath, ontologyStore, onProgress);
    },
    unlink: (systemId: string) => ontologyStore.unlink(systemId),
    roots: (systemId: string) => ontologyStore.roots(systemId),
    children: (systemId: string, parent: string) => ontologyStore.children(systemId, parent),
    node: (systemId: string, code: string) => ontologyStore.node(systemId, code),
    search: (systemId: string, query: string) => ontologyStore.search(systemId, query),
    path: (systemId: string, code: string) => ontologyStore.path(systemId, code),
    panelMembers: (systemId: string, panel: string) => ontologyStore.panelMembers(systemId, panel),
    answerOptions: (systemId: string, loinc: string) => ontologyStore.answerOptions(systemId, loinc),
    specimenCodes: (systemId: string, loinc: string) => ontologyStore.specimenCodes(systemId, loinc),
  };
}

export interface AppContext {
  logger: Logger;
  auth: AuthPort;
  blob: BlobStoragePort;
  eventing: EventingPort;
  store: TargetStorePort;
  internalDb: Kysely<InternalSchema>;
  fhirStore: FhirStore;
  audit: AuditStore;
  reportRuns: ReportRunStore;
  reportSchedules: ReportScheduleStore;
  reportScheduler: ReportScheduler;
  users: UserStore;
  userProfiles: UserProfileStore;
  forms: FormStore;
  reporting: ReportingApi;
  health: HealthRegistry;
  terminology: {
    ops: Operations;
    admin: TerminologyAdminStore;
    ontology: ReturnType<typeof createOntologyApi>;
    loaders: {
      loinc(dir: string, acceptLicense: boolean): Promise<LoadResult>;
      amr(sqlitePath: string): Promise<LoadResult[]>;
      resource(json: unknown): Promise<LoadResult>;
    };
  };
  dashboards: DashboardsApi;
  workflows: {
    store: WorkflowStore;
    runs: WorkflowRunStore;
    schedules: WorkflowScheduleStore;
    webhooks: WebhookRegistry;
    runner: WorkflowTriggerRunner;
  };
  plugins: PluginRuntime;
  cfg: Config;
  close(): Promise<void>;
}

export async function createAppContext(cfg: Config): Promise<AppContext> {
  const logger = createLogger({ level: cfg.LOG_LEVEL });

  const auth = createAuth({
    issuerUrl: cfg.OIDC_ISSUER_URL,
    audience: cfg.OIDC_AUDIENCE,
    adminClientId: cfg.KEYCLOAK_ADMIN_CLIENT_ID,
    adminClientSecret: cfg.KEYCLOAK_ADMIN_CLIENT_SECRET,
  });
  const blob = createS3Bucket({
    endpoint: cfg.S3_ENDPOINT,
    region: cfg.S3_REGION,
    accessKeyId: cfg.S3_ACCESS_KEY_ID,
    secretAccessKey: cfg.S3_SECRET_ACCESS_KEY,
    bucket: cfg.S3_BUCKET,
    forcePathStyle: cfg.S3_FORCE_PATH_STYLE,
  });
  const eventing = createEventBus({ url: cfg.INTERNAL_DATABASE_URL });
  const { store } = selectTargetStore(cfg);
  const internal = createInternalDb(cfg.INTERNAL_DATABASE_URL);
  const audit = createAuditStore(internal.db);
  const reportRuns = createReportRunStore(internal.db);
  const reportSchedules = createReportScheduleStore(internal.db);
  const plugins = createPluginRegistry({ blob, internalDb: internal.db, logger, audit, devAllowUnsigned: cfg.MARKETPLACE_DEV_ALLOW_UNSIGNED });
  const users = createUserStore(internal.db);
  const userProfiles = createUserProfileStore(internal.db);
  const forms = createFormStore(internal.db);
  const reportingDb = store.db as unknown as Kysely<ExternalSchema>;
  const runReport = async (id: string, rawParams: unknown): Promise<ReportResult> => {
    const def = getReport(id);
    if (!def) throw new ReportNotFoundError(id);
    const params = def.params.parse(rawParams);
    const data = await def.run(reportingDb, params);
    return { ...data, meta: { generatedAt: new Date().toISOString(), rowCount: data.rows.length } };
  };
  const reporting: ReportingApi = {
    list: () => reportSummaries(),
    eventSources: () => eventSourceCatalog().map((s) => ({ id: s.id, name: s.name, columns: s.columns })),
    run: runReport,
    async runEventSource(id, window) {
      const src = getEventSource(id);
      if (!src) throw new ReportNotFoundError(id);
      return src.run(reportingDb, window);
    },
    async renderPdf(id, rawParams) {
      const result = await runReport(id, rawParams);
      const def = getReport(id)!;
      return renderReportPdf({
        title: def.name,
        generatedAt: result.meta.generatedAt,
        params: (rawParams ?? {}) as Record<string, unknown>,
        columns: result.columns.map((c) => ({ key: c.key, label: c.label })),
        rows: result.rows,
      });
    },
    async options(id) {
      const def = getReport(id);
      if (!def) throw new ReportNotFoundError(id);
      return def.options ? def.options(reportingDb) : {};
    },
  };

  const reportScheduler = createReportScheduler({
    reporting,
    blob,
    schedules: reportSchedules,
    logger,
  });

  const dashboardStore = createDashboardStore(internal.db);
  const runDashboardQuery = async (q: WidgetQuery): Promise<ReportResult> => {
    let data;
    if (q.mode === 'builder') {
      const model = getModel(q.model);
      if (!model) throw new DashboardQueryError(`unknown model: ${q.model}`);
      data = await runBuilderQuery(reportingDb, model, q);
    } else {
      if (!cfg.DASHBOARD_SQL_ENABLED || cfg.TARGET_STORE_ADAPTER !== 'pg') {
        throw new DashboardQueryError('raw SQL widgets are disabled');
      }
      data = await runSqlQuery(reportingDb, q.sql, { timeoutMs: cfg.DASHBOARD_SQL_TIMEOUT_MS, rowCap: cfg.DASHBOARD_SQL_ROW_CAP });
    }
    return { ...data, meta: { generatedAt: new Date().toISOString(), rowCount: data.rows.length } };
  };
  const dashboards: DashboardsApi = { store: dashboardStore, models: () => listModels(), query: runDashboardQuery };
  const workflowStore = createWorkflowStore(internal.db);
  const workflowRuns = createWorkflowRunStore(internal.db);
  const workflowSchedules = createWorkflowScheduleStore(internal.db);
  const workflowWebhooks = createWebhookRegistry();
  const workflowRunner = createWorkflowTriggerRunner({
    store: workflowStore, runs: workflowRuns, schedules: workflowSchedules,
    webhooks: workflowWebhooks, runWorkflow, logger,
  });
  const workflows = { store: workflowStore, runs: workflowRuns, schedules: workflowSchedules, webhooks: workflowWebhooks, runner: workflowRunner };

  const health = new HealthRegistry();
  health.register({ name: 'auth', check: () => auth.healthCheck() });
  health.register({ name: 'blob', check: () => blob.healthCheck() });
  health.register({ name: 'eventing', check: () => eventing.healthCheck() });
  health.register({ name: 'target-store', check: () => store.healthCheck() });

  const termDb = internal.db as unknown as Kysely<InternalSchema>;
  const termFhirStore = createFhirStore(termDb);
  const termStore = createTerminologyStore(termDb, termFhirStore);
  const termProjection = {
    async saveValueSetResource(resource: Record<string, unknown>): Promise<string> {
      const saved = await termFhirStore.save(resource as never);
      return (saved as { id?: string })?.id ?? String((resource as { id?: string }).id ?? '');
    },
    async registerSystem(url: string, version: string | null, kind: string, resourceId: string): Promise<void> {
      await termStore.saveSystem(url, version, kind, resourceId);
    },
    async deleteValueSetResource(url: string): Promise<void> {
      await termDb.deleteFrom('terminology_systems').where('url', '=', url).execute();
    },
  };
  const termAdmin = createTerminologyAdminStore(termDb, termProjection);
  const termOntology = createOntologyApi(createOntologyStore(termDb));
  const loaderStore: LoaderStore = {
    upsertConcepts: (r) => termStore.upsertConcepts(r),
    upsertMapElements: (r) => termStore.upsertMapElements(r),
    saveResource: (res) => termFhirStore.save(res as never),
    saveSystem: async (url, version, kind, id) => {
      await termStore.saveSystem(url, version, kind, id);
      if (kind === 'CodeSystem') {
        try {
          await termAdmin.codingSystems.upsertByUrl({
            url,
            systemCode: deriveSystemCode(url),
            systemName: deriveSystemCode(url),
            systemVersion: version,
            publisherId: resolveSeedPublisherId(url),
          });
        } catch (e) {
          console.warn('[terminology] coding_systems projection failed:', redact(e instanceof Error ? e.message : String(e)));
        }
      }
    },
  };
  const terminology: AppContext['terminology'] = {
    ops: createOperations({
      getConcept: (s, c) => termStore.getConcept(s, c),
      findConcepts: (q) => termStore.findConcepts(q),
      countConcepts: (q) => termStore.countConcepts(q),
      getResourceByUrl: (u) => termStore.getResourceByUrl(u),
      translate: (q) => termStore.translate(q),
    }),
    admin: termAdmin,
    ontology: termOntology,
    loaders: {
      loinc: (dir, acceptLicense) => loadLoinc(dir, { acceptLicense }, loaderStore),
      amr: (p) => loadWhonetAmr(p, loaderStore),
      resource: (json) => importTerminologyResource(json, loaderStore),
    },
  };

  return {
    logger,
    auth,
    blob,
    eventing,
    store,
    internalDb: internal.db,
    fhirStore: termFhirStore,
    audit,
    reportRuns,
    reportSchedules,
    reportScheduler,
    users,
    userProfiles,
    forms,
    reporting,
    health,
    terminology,
    dashboards,
    workflows,
    plugins,
    cfg,
    async close() {
      await Promise.allSettled([eventing.close(), store.close(), internal.close()]);
    },
  };
}

export { CE_VERSION } from './plugin-registry';
export * from './db-context';
export * from './dhis2-context';
export * from './ingest-context';
export * from './target-store';
export * from './terminology-context';
export * from './seed';
