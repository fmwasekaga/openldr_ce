import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import * as XLSX from 'xlsx';
import pg from 'pg';
import { Kysely, sql } from 'kysely';
import { createAuth } from '@openldr/adapter-auth';
import { createEventBus } from '@openldr/adapter-event-bus';
import { createS3Bucket } from '@openldr/adapter-s3-bucket';
import { toS3BucketConfig } from './s3-config';
import type { Config } from '@openldr/config';
import { createLogger, HealthRegistry, open, seal, parseSecretKey, redact, type Logger } from '@openldr/core';
import { createInternalDb, createFhirStore, createRelationalWriter, persistResources, createTerminologyStore, createTerminologyAdminStore, createOntologyStore, createReportRunStore, createReportScheduleStore, createMarketplaceInstallStore, createRegistryStore, createAppSettingsStore, deriveSystemCode, resolveSeedPublisherId, createProjectionRunner, fetchSafeChangeRows, readCursor as readChangeCursor, advanceCursor as advanceChangeCursor, createReferenceApplier, referenceCapture, markTerminologyChanged, createRoleStore, type TerminologyAdminStore, type OntologyStore, type FhirStore, type ReportRunStore, type ReportScheduleStore, type AppSettingStore, type RoleStore } from '@openldr/db';
import type { ExternalSchema, InternalSchema, Provenance, SyncActivityStore } from '@openldr/db';
import type { AuthPort, BlobStoragePort, EventingPort, TargetStorePort } from '@openldr/ports';
import { createAuditStore, safeRecord, type AuditStore } from '@openldr/audit';
import { createUserStore, type UserStore, createUserProfileStore, type UserProfileStore } from '@openldr/users';
import { createFormStore, type FormStore } from '@openldr/forms';
import { getEventSource, eventSourceCatalog, toCsv, type ReportResult, type ReportSummary, type ReportParamMeta, type ReportMetricMeta } from '@openldr/reporting';
import { createDashboardStore, getModel, runBuilderQuery, runSqlQuery, applyTemplate, resolveValues, collectVettedSqlTemplates, isSqlExecutionAllowed, seedDefaultDashboard, runStoredQuery, compileBuilderQuery, formatSql, modelsForClient, joinableTablesForClient, type DashboardStore, type WidgetQuery, type RunStoredQueryDeps, type ClientQueryModel, type ClientJoinableTable } from '@openldr/dashboards';
import { createReportDesignStore, renderReportDesignPdf, resolveDesignTables, type ReportDesignStore } from '@openldr/report-designer';
import {
  createWorkflowStore, type WorkflowStore,
  createWorkflowRunStore, type WorkflowRunStore,
  createWorkflowScheduleStore, type WorkflowScheduleStore,
  createWebhookRegistry, type WebhookRegistry,
  createWorkflowTriggerRunner, type WorkflowTriggerRunner,
  createWorkflowDatasetStore, type WorkflowDatasetStore,
  runWorkflow, WorkflowDefinitionSchema, assertSubWorkflowAllowed, extractTerminalItems,
  guardedFetch, type WorkflowServices,
} from '@openldr/workflows';
import { renderReportPdf } from '@openldr/report-pdf';
import { createDbContext } from './db-context';
import { seedDatabase } from './seed';
import { wipeInternalDatabase, clearAuditAndRunHistory } from './danger';
import { createReportScheduler, type ReportScheduler } from './report-scheduler';
import { createPluginScheduleApi, createPluginScheduleRunner, type PluginScheduleRunner } from './plugin-schedule';
import { createFormArtifactInstaller, type FormArtifactInstaller } from './form-artifact-install';
import { type PluginRuntime } from '@openldr/plugins';
import { createConnectorStore, createPluginDataStore, type PluginDataStore, type ConnectorStore, createReportStore, type ReportStore, type ReportRecord, createCustomQueryStore, createSyncSiteStore, type SyncSiteStore, createWorkflowSecretStore, type WorkflowSecretStore, createSyncQuarantineStore, createSyncDivergenceStore, createSyncSiteCursorStore, type SyncSiteCursorStore, createSyncActivityStore, createTerminologyIngestJobStore, type TerminologyIngestJobStore } from '@openldr/db';
import type { ReportDesign } from '@openldr/report-designer/pure';
import { createBatchStore } from '@openldr/ingest';
import { createSyncPushRunner, createSyncPullRunner, createAmendmentPullRunner, createSyncTokenProvider, createTerminologyBulkSync, readSyncConfig, combineCycleResults, type PushBatch, type PushResponse, type SyncConfig } from '@openldr/sync';
import { createSyncPushWorker } from './sync-push-worker';
import { createSyncPullWorker } from './sync-pull-worker';
import { createSyncHandle, type SyncHandle } from './sync-handle';
import { createSyncRuntime, type SyncRuntime, type BuiltPush, type BuiltPull } from './sync-runtime';
import { createRetryQuarantine } from './sync-retry-quarantine';
import { createSyncActivityTracker } from './sync-activity-tracker';
import { migrateLegacySyncConfig } from './sync-settings-migrate';
import { encodePushBody, advertisesGzip } from './sync-gzip';
import { migrateWorkflowSecrets } from './workflow-secret-migrate';

import { createActivityService, type ActivityService } from './activity-service';
import { createFeatureFlags, type FeatureFlags } from './feature-flags';
import { createNumberSettings, type NumberSettings } from './number-settings';
import { createValidationStrictness, type ValidationStrictness } from './validation-settings';
export { createValidationStrictness, VALIDATION_STRICTNESS_KEY, type ValidationStrictness } from './validation-settings';
import { createReportCategoriesService, type ReportCategoriesService } from './report-categories';
import { createPluginBroker, type PluginBroker } from './plugin-broker';
import { policyFromConfig } from './policy';
import { createPluginTarget } from './connector-target';
import { createPluginNodeService } from './plugin-node-service';
import { createFormValidateService } from './form-validate-service';
import { createPersistStoreService } from './persist-store-service';
import { createConnectorSqlRunner } from './connector-sql-service';
import { createConnectorMongoRunner } from './connector-mongo-service';
import { createConnectorRedisRunner } from './connector-redis-service';
import { createConnectorEmailRunner } from './connector-email-service';
import { createConnectorSftpRunner } from './connector-sftp-service';
import { createHostFileService } from './host-file-service';
import { createWorkflowListenerManager } from './workflow-listeners';
import { createPostgresListenerDriver } from './listener-postgres';
import { createEmailListenerDriver } from './listener-email';
import { createDhis2Orchestration } from './dhis2-orchestration';
import { selectTargetStore } from './target-store';
import { createPluginRegistry } from './plugin-registry';
import { createProjectionWorker } from './projection-worker';
import { buildOntologyDistribution, canonicalSystemUrl, createOperations, importTerminologyResource, loadLoinc, loadWhonetAmr, stalenessReason, type LoaderStore, type LoadResult, type OntologyBuildProgress, type OntologyManifest, type OntologyType, type Operations } from '@openldr/terminology';
import { createTerminologyIngestWorker } from './terminology-ingest-worker';
import { createRunIngest } from './terminology-ingest-shared';

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
  models(): ClientQueryModel[];
  /** The admin-governed universe of joinable tables (global; not per-model), browser-safe. */
  joinableTables(): ClientJoinableTable[];
  query(q: WidgetQuery): Promise<ReportResult>;
  /** Builder→SQL eject: compile a builder-mode query to its SQL text (parameters inlined as
   *  readable literals). Display-only — the returned text is never executed. */
  compileSql(q: Extract<WidgetQuery, { mode: 'builder' }>): Promise<string>;
}

export interface ReportingApi {
  list(): ReportSummary[];
  listAll(): Promise<ReportSummary[]>;
  findSummary(id: string): Promise<ReportSummary | undefined>;
  run(id: string, rawParams: unknown): Promise<ReportResult>;
  runEventSource(id: string, window: { from: string; to: string }): Promise<{ rows: Record<string, unknown>[] }>;
  eventSources(): { id: string; name: string; columns: { key: string; label: string }[] }[];
  renderPdf(id: string, rawParams: unknown): Promise<Buffer>;
  options(id: string): Promise<Record<string, string[]>>;
}

export function reportDefToSummary(def: ReportRecord, design: ReportDesign): ReportSummary {
  const parameters: ReportParamMeta[] = design.parameters.map((p) => {
    const type = (p.type ?? 'text') as ReportParamMeta['type'];
    const base: ReportParamMeta = { id: p.key, label: p.label, type, required: Boolean(p.required) };
    if (type === 'select' && def.paramOptions?.[p.key]) base.optionsKey = p.key;
    return base;
  });
  return {
    id: def.id, name: def.name, description: def.description,
    category: def.category as ReportSummary['category'],
    parameters,
    summaryMetrics: (def.summaryMetrics ?? undefined) as ReportMetricMeta[] | undefined,
    source: 'design',
    designId: def.designId,
  };
}

/** Deps for the data-driven ("reports" table) branch of the reporting service — the third
 *  report source alongside the hardcoded catalog and published builder templates. Factored out
 *  as a standalone, dependency-injected unit so it can be unit-tested without a real DB/connector
 *  (see `buildReportingForTest`); production wires it with the real stores in `createAppContext`. */
export interface ReportingDataDrivenDeps {
  reportDefs: Pick<ReportStore, 'list' | 'get'>;
  reportDesigns: Pick<ReportDesignStore, 'get'>;
  runStoredQuery: (queryId: string, values: Record<string, unknown>) => Promise<{ columns: { key: string; label: string }[]; rows: Record<string, unknown>[] }>;
  resolveDesignTables: typeof resolveDesignTables;
  renderReportDesignPdf: typeof renderReportDesignPdf;
}

/** A data-driven report's `/reports` filter bar omits an optional select filter's key when the
 *  user never touches it (see `ReportParametersBar`), but `substituteParams` throws on any
 *  `{{param.X}}` token missing from `values`. Fall back to the design's own param defaults so an
 *  untouched optional filter still resolves — incoming values always win. Only string defaults are
 *  applied: a daterange param's `{from,to}` object value doesn't map to the flat `from`/`to` keys
 *  the queries use, and daterange filters are required anyway (so there's nothing to default). */
function designDefaults(design: ReportDesign): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const p of design.parameters) if (typeof p.value === 'string') out[p.key] = p.value;
  return out;
}

function createDataDrivenReporting(deps: ReportingDataDrivenDeps) {
  const valuesOf = (rawParams: unknown) => (rawParams ?? {}) as Record<string, unknown>;

  async function runDataDriven(id: string, rawParams: unknown): Promise<ReportResult> {
    const def = (await deps.reportDefs.get(id))!;
    const design = await deps.reportDesigns.get(def.designId);
    if (!design) throw new ReportNotFoundError(def.designId);
    const values = { ...designDefaults(design), ...valuesOf(rawParams) };
    const { columns, rows } = await deps.runStoredQuery(def.primaryQueryId, values);
    const chart = (def.chart ?? { type: 'stat', value: String(rows.length), label: 'rows' }) as ReportResult['chart'];
    const cols = columns.map((c) => ({ key: c.key, label: c.label, kind: 'string' as const }));
    return { columns: cols, rows, chart, meta: { generatedAt: new Date().toISOString(), rowCount: rows.length } };
  }

  async function renderDataDriven(id: string, rawParams: unknown): Promise<Buffer> {
    const def = (await deps.reportDefs.get(id))!;
    const design = await deps.reportDesigns.get(def.designId);
    if (!design) throw new ReportNotFoundError(def.designId);
    const values = { ...designDefaults(design), ...valuesOf(rawParams) };
    const resolved = await deps.resolveDesignTables(design, values, deps.runStoredQuery);
    return deps.renderReportDesignPdf(design, resolved);
  }

  async function optionsDataDriven(id: string): Promise<Record<string, string[]>> {
    const def = (await deps.reportDefs.get(id))!;
    const out: Record<string, string[]> = {};
    for (const [paramKey, queryId] of Object.entries(def.paramOptions ?? {})) {
      const { columns, rows } = await deps.runStoredQuery(queryId, {});
      const col = columns[0]?.key;
      out[paramKey] = col ? rows.map((r) => String(r[col])).filter((v) => v !== 'null' && v !== '') : [];
    }
    return out;
  }

  async function listAllDataDriven(): Promise<ReportSummary[]> {
    const defs = await deps.reportDefs.list();
    const summaries = await Promise.all(
      defs.filter((d) => d.status === 'published').map(async (d) => {
        const design = await deps.reportDesigns.get(d.designId);
        return design ? reportDefToSummary(d, design) : null;
      }),
    );
    return summaries.filter((s): s is ReportSummary => s !== null);
  }

  async function findSummaryDataDriven(id: string): Promise<ReportSummary | undefined> {
    const def = await deps.reportDefs.get(id);
    if (!def) return undefined;
    const design = await deps.reportDesigns.get(def.designId);
    return design ? reportDefToSummary(def, design) : undefined;
  }

  return { runDataDriven, renderDataDriven, optionsDataDriven, listAllDataDriven, findSummaryDataDriven };
}

/** Test seam for the data-driven reporting branch (Task 2.3): builds just the
 *  listAll/findSummary/run/renderPdf/options surface backed by injected fakes, so
 *  `reporting-data-driven.test.ts` can assert all five behaviors without a real DB/connector.
 *  Production (`createAppContext`) wires the same `createDataDrivenReporting` factory with the
 *  real `reportDefStore`/`reportDesignStore`/`runReportQuery` and folds it into the full
 *  `ReportingApi` alongside the catalog + builder-template branches. */
export function buildReportingForTest(
  deps: ReportingDataDrivenDeps,
): Pick<ReportingApi, 'listAll' | 'findSummary' | 'run' | 'renderPdf' | 'options'> {
  const dd = createDataDrivenReporting(deps);
  return {
    listAll: () => dd.listAllDataDriven(),
    findSummary: (id) => dd.findSummaryDataDriven(id),
    run: (id, rawParams) => dd.runDataDriven(id, rawParams),
    renderPdf: (id, rawParams) => dd.renderDataDriven(id, rawParams),
    options: (id) => dd.optionsDataDriven(id),
  };
}

/** Map a dataset name to a safe `wf_ds_<...>` table identifier. */
function datasetTableName(name: string): string {
  const safe = name.toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/^_+|_+$/g, '').slice(0, 48) || 'ds';
  return `wf_ds_${safe}`;
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
  pluginScheduleRunner: PluginScheduleRunner;
  users: UserStore;
  /** Capability-based roles (RBAC Task 4): system + custom roles, capability grants, and
   *  user↔role assignment. Seeded with the 5 system roles on every `createAppContext` boot —
   *  see the `seedSystemRoles()` call beside its construction below. */
  roles: RoleStore;
  userProfiles: UserProfileStore;
  forms: FormStore;
  marketplaceForms: FormArtifactInstaller;
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
    ingestOntologyWithConcepts(systemType: string, systemId: string, dir: string, onProgress: (p: { phase: string; processed: number; total: number | null }) => void): Promise<{ conceptsLoaded: number }>;
  };
  dashboards: DashboardsApi;
  reportDesigns: ReportDesignStore;
  reportDefs: ReportStore;
  reportCategories: ReportCategoriesService;
  /** Sync S4d: central-side registry of enrolled labs (site_id → client_id, status, who/when).
   *  Never stores the client secret. The enrollment orchestrator writes here + ctx.auth.clients. */
  syncSites: SyncSiteStore;
  /** Sync S7 (A1): what each lab reports it has consumed of the two central-side logs it pulls
   *  (reference_change_log, sync_amendments). Built unconditionally (see the construction site,
   *  beside the quarantine/divergence stores) — a later retention slice reads these on any node,
   *  regardless of which sync workers this boot started. Nothing trims against them yet. */
  syncSiteCursors: SyncSiteCursorStore;
  workflows: {
    store: WorkflowStore;
    runs: WorkflowRunStore;
    schedules: WorkflowScheduleStore;
    webhooks: WebhookRegistry;
    runner: WorkflowTriggerRunner;
    services: WorkflowServices;
    datasets: WorkflowDatasetStore;
    listeners: { reconcile(): Promise<void>; stopAll(): Promise<void> };
    /** SEC-06: encrypted store for secrets extracted from workflow definitions. */
    secretStore: WorkflowSecretStore;
  };
  plugins: PluginRuntime;
  pluginData: PluginDataStore;
  pluginBroker: PluginBroker;
  connectors: ConnectorStore;
  appSettings: AppSettingStore;
  featureFlags: FeatureFlags;
  numberSettings: NumberSettings;
  /** Gates persistResources() strictness for the webhook (Persist Store node) and ingest paths
   *  (Task 8). Reads the level fresh per persist call so runtime setting changes apply immediately. */
  validationStrictness: ValidationStrictness;
  activity: ActivityService;
  /** Seal a plaintext secret for at-rest storage (AES-256-GCM under SECRETS_ENCRYPTION_KEY).
   *  Symmetric with {@link decryptSecret}; used by the sync settings route/CLI to write-encrypt
   *  the client secret. */
  encryptSecret(plain: string): string;
  /** Inverse of {@link encryptSecret}. Mirrors the internal `syncDecrypt`. */
  decryptSecret(blob: string): string;
  /** Sync status + trigger surface (Task 5). ALWAYS present: when sync is disabled, status()
   *  reports `enabled:false` with null directions and triggerNow() is a no-op. */
  sync: SyncHandle;
  /** Track A: bounded, high-signal sync outcome feed. The `/api/settings/sync/activity` endpoint reads
   *  it; the runners write it (via the in-memory tracker). */
  syncActivity: SyncActivityStore;
  /** Task 6: terminology distribution ingest job queue (upload → claim → ingest → audit →
   *  retain-latest). The worker built alongside it (see `terminologyIngestWorker` in
   *  `createAppContext`) polls this store; Task 7's routes read/enqueue against it. */
  terminologyJobs: TerminologyIngestJobStore;
  /** The re-runnable sync worker lifecycle. reconcile() re-reads config and rebuilds the workers,
   *  which is how a Settings toggle takes effect without a restart (Task 4 calls it). */
  syncRuntime: SyncRuntime;
  cfg: Config;
  close(): Promise<void>;
}

export async function createAppContext(cfg: Config): Promise<AppContext> {
  const logger = createLogger({ level: cfg.LOG_LEVEL });

  const auth = createAuth({
    issuerUrl: cfg.OIDC_ISSUER_URL,
    audience: cfg.OIDC_AUDIENCE,
    internalJwksUrl: cfg.OIDC_INTERNAL_JWKS_URL,
    internalIssuerUrl: cfg.OIDC_INTERNAL_ISSUER_URL,
    adminClientId: cfg.KEYCLOAK_ADMIN_CLIENT_ID,
    adminClientSecret: cfg.KEYCLOAK_ADMIN_CLIENT_SECRET,
  });
  const blob = createS3Bucket(toS3BucketConfig(cfg));
  const eventing = createEventBus({ url: cfg.INTERNAL_DATABASE_URL });
  const { store, engine } = selectTargetStore(cfg);
  const externalDb = store.db as unknown as Kysely<ExternalSchema>;
  const internal = createInternalDb(cfg.INTERNAL_DATABASE_URL);
  const audit = createAuditStore(internal.db);
  const reportRuns = createReportRunStore(internal.db);
  const reportSchedules = createReportScheduleStore(internal.db);
  const plugins = createPluginRegistry({ blob, internalDb: internal.db, logger, audit, devAllowUnsigned: cfg.MARKETPLACE_DEV_ALLOW_UNSIGNED });
  const users = createUserStore(internal.db);
  const roles = createRoleStore(internal.db);
  // RBAC Task 4: seed the 5 system roles (lab_admin/lab_manager/data_analyst/system_auditor/
  // lab_technician) on every boot. Deliberately UNCONDITIONAL — NOT routed through seedDatabase()/
  // SEED_ON_START (apps/server/src/index.ts), because that flag defaults to false and only guards
  // optional demo/sample data (see seed.ts); a real production install would never seed roles if
  // this depended on it. seedSystemRoles() is idempotent (safe to call on every boot) so this
  // covers a fresh install AND an existing-DB upgrade to this feature identically. Mirrors the
  // migrateWorkflowSecrets/migrateLegacySyncConfig best-effort shims further below: wrapped so a
  // pre-migration DB or a transient connection failure logs a warning and never aborts boot.
  await roles.seedSystemRoles().catch((err) => {
    logger.warn({ err }, 'system-role seed failed');
  });
  const userProfiles = createUserProfileStore(internal.db);
  // Sync S2: pass referenceCapture so central config authoring lands rows in reference_change_log
  // (the pull endpoint's source). Safe on every node: a lab serves no pull so its log is inert, and
  // the apply path writes tables directly (capture-free) → no re-origination loop.
  const forms = createFormStore(internal.db, referenceCapture);
  const marketplaceInstalls = createMarketplaceInstallStore(internal.db);

  // Canonical persist for the Persist Store workflow node — same wiring as ingest-context.
  const canonicalFhirStore = createFhirStore(internal.db);
  const workflowRelationalWriter = createRelationalWriter(externalDb, engine);
  // Gate enforcement is wired via `validationStrictness`, defined below alongside the rest of the
  // app-settings-backed services — this closure isn't invoked until after bootstrap() returns, so
  // the forward reference resolves by the time a caller actually persists.
  const workflowPersist = async (resources: unknown[], prov: Provenance) =>
    persistResources({ fhirStore: canonicalFhirStore, logger }, resources, prov, {
      level: await validationStrictness.get(),
      resolveServiceRequest: (id: string) => canonicalFhirStore.exists('ServiceRequest', id),
    });
  const marketplaceForms = createFormArtifactInstaller({ forms, installStore: marketplaceInstalls, audit });

  // Seed a default marketplace registry from the legacy env vars the first time (table empty),
  // so existing deployments keep working without manual setup. No-op once any row exists.
  try {
    const registriesSeedStore = createRegistryStore(internal.db as unknown as Kysely<InternalSchema>);
    if ((await registriesSeedStore.list()).length === 0) {
      if (cfg.MARKETPLACE_REGISTRY_URL) {
        await registriesSeedStore.create({ id: 'env-http', name: 'Default registry', kind: 'http', location: cfg.MARKETPLACE_REGISTRY_URL });
      } else if (cfg.MARKETPLACE_REGISTRY_DIR) {
        await registriesSeedStore.create({ id: 'env-local', name: 'Local registry', kind: 'local', location: cfg.MARKETPLACE_REGISTRY_DIR });
      }
    }
  } catch (e) {
    logger.warn({ err: e }, 'bootstrap: registry seed skipped (internal DB not ready)');
  }

  const reportingDb = store.db as unknown as Kysely<ExternalSchema>;

  // Reports are now fully data-driven ("reports" table: a design + a bound primary query) — the
  // hardcoded catalog (`@openldr/reporting`'s `catalog.ts`, `getReport`/`reportSummaries`/
  // `ReportDefinition`) was retired in Slice S6 of
  // docs/superpowers/plans/2026-07-09-reports-template-linking.md once its last report
  // (`amr-antibiogram`) was migrated to a fixed-panel data-driven report, and the deprecated
  // `@openldr/report-builder` (PDF-only templates, `source:'builder'`) was retired entirely once
  // Report Designer superseded it. Declared above the `reporting` object so its branch closures
  // (via `dataDrivenReporting`, below) can reference them. `reportRenderDeps.runConnectorSql` reads
  // `workflowServices` lazily at call time (it is declared further down this function) — mirrors
  // the same lazy-read pattern in apps/server/app.ts.
  const reportDesignStore = createReportDesignStore(internal.db);
  const reportDefStore = createReportStore(internal.db, referenceCapture);
  const syncSites = createSyncSiteStore(internal.db);
  const reportRenderDeps: RunStoredQueryDeps = {
    customQueries: createCustomQueryStore(internal.db),
    runConnectorSql: (input) => {
      const run = workflowServices.runConnectorSql;
      if (!run) throw new Error('connector SQL runner unavailable');
      return run(input);
    },
  };
  const runReportQuery = (queryId: string, values: Record<string, unknown>) =>
    runStoredQuery(reportRenderDeps, queryId, values);
  const dataDrivenReporting = createDataDrivenReporting({
    reportDefs: reportDefStore,
    reportDesigns: reportDesignStore,
    runStoredQuery: runReportQuery,
    resolveDesignTables,
    renderReportDesignPdf,
  });

  const reporting: ReportingApi = {
    // Catalog-only, synchronous by design (see the 2026-07-05 phase4 spec's "Sync `list()`
    // untouched" note — report-scheduler.ts/plugin-broker.ts/CLI `report list` are its only
    // consumers). Now that the catalog is empty, this always returns []; those consumers already
    // tolerate a missing definition (falling back to the raw id/no date-range default). `listAll()`
    // (async) is what /api/reports and the Reports page use.
    list: () => [],
    listAll: () => dataDrivenReporting.listAllDataDriven(),
    findSummary: (id) => dataDrivenReporting.findSummaryDataDriven(id),
    eventSources: () => eventSourceCatalog().map((s) => ({ id: s.id, name: s.name, columns: s.columns })),
    async run(id, rawParams) {
      if (await reportDefStore.get(id)) return dataDrivenReporting.runDataDriven(id, rawParams);
      throw new ReportNotFoundError(id);
    },
    async runEventSource(id, window) {
      const src = getEventSource(id);
      if (!src) throw new ReportNotFoundError(id);
      return src.run(reportingDb, window);
    },
    async renderPdf(id, rawParams) {
      if (await reportDefStore.get(id)) return dataDrivenReporting.renderDataDriven(id, rawParams);
      throw new ReportNotFoundError(id);
    },
    async options(id) {
      if (await reportDefStore.get(id)) return dataDrivenReporting.optionsDataDriven(id);
      throw new ReportNotFoundError(id);
    },
  };

  const reportScheduler = createReportScheduler({
    reporting,
    blob,
    schedules: reportSchedules,
    logger,
  });

  const dashboardStore = createDashboardStore(internal.db, referenceCapture);
  const runDashboardQuery = async (q: WidgetQuery): Promise<ReportResult> => {
    let data;
    if (q.mode === 'builder') {
      const model = getModel(q.model);
      if (!model) throw new DashboardQueryError(`unknown model: ${q.model}`);
      data = await runBuilderQuery(reportingDb, model, q);
    } else {
      // `q.sql` is the STORED template verbatim (the client sends resolved filter `values`
      // separately and the server applies the substitution). Vet the untouched template against
      // the SQL persisted on stored dashboards so filtered widgets still match. Execution is
      // allowed only when the flag is on OR the template is vetted (first-party/admin-authored).
      const vetted = collectVettedSqlTemplates(await dashboardStore.list());
      const sqlEnabled = await featureFlags.get('dashboard.raw_sql');
      if (!isSqlExecutionAllowed(sqlEnabled, q.sql, vetted)) {
        throw new DashboardQueryError('raw SQL widgets are disabled');
      }
      const finalSql = q.values ? applyTemplate(q.sql, resolveValues(q.values)) : q.sql;
      data = await runSqlQuery(reportingDb, finalSql, {
        timeoutMs: await numberSettings.get('dashboard.sql_timeout_ms'),
        rowCap: await numberSettings.get('dashboard.sql_row_cap'),
      }, cfg.TARGET_STORE_ADAPTER === 'mssql' ? 'mssql' : cfg.TARGET_STORE_ADAPTER === 'mysql' ? 'mysql' : 'postgres');
    }
    return { ...data, meta: { generatedAt: new Date().toISOString(), rowCount: data.rows.length } };
  };
  // Builder→SQL eject: compile the builder query the same way `runDashboardQuery` does, but
  // return the SQL text (parameters inlined as readable literals) instead of running it.
  const compileDashboardSql = async (q: Extract<WidgetQuery, { mode: 'builder' }>): Promise<string> => {
    const model = getModel(q.model);
    if (!model) throw new DashboardQueryError(`unknown model: ${q.model}`);
    const { sql: compiledSql, parameters } = compileBuilderQuery(reportingDb, model, q).compile();
    return formatSql(compiledSql, parameters);
  };
  const dashboards: DashboardsApi = { store: dashboardStore, models: () => modelsForClient(), joinableTables: () => joinableTablesForClient(), query: runDashboardQuery, compileSql: compileDashboardSql };
  const workflowStore = createWorkflowStore(internal.db);
  const workflowRuns = createWorkflowRunStore(internal.db);
  const workflowSchedules = createWorkflowScheduleStore(internal.db);
  // SEC-06: the secret store is constructed BEFORE the webhook registry + workflow
  // services so both can resolve sealed `{ secretRef }` values at use (the registry
  // resolves the webhook secret on sync; the HTTP node resolves a ref-valued headers
  // blob). Injected resolvers keep `@openldr/workflows` crypto-key-free.
  const workflowSecrets = createWorkflowSecretStore(internal.db);
  const workflowWebhooks = createWebhookRegistry({
    // Open the sealed webhook-secret ref → plaintext (held in memory). A failure to
    // resolve (unknown id / key unset / rotated key) registers a null secret rather
    // than crashing reconcile — the route then fails closed (401 "no secret configured").
    // Log a warning so a silently-bricked hook has an operator signal (SEC-06).
    resolveRef: (ref) =>
      workflowSecrets.resolve(ref, cfg.SECRETS_ENCRYPTION_KEY).catch((err) => {
        logger.warn({ ref, err }, 'SEC-06: webhook secret ref failed to resolve — hook will 401');
        return null;
      }),
  });
  const workflowDatasets = createWorkflowDatasetStore(internal.db);

  const ingestBatches = createBatchStore(internal.db);
  const persistedEvent = async (correlationId: string) => {
    const row = await internal.db.selectFrom('outbox_events')
      .select(['payload', 'created_at'])
      .where('batch_id', '=', correlationId)
      .where('type', '=', 'data.persisted')
      .orderBy('created_at', 'asc')
      .executeTakeFirst();
    if (!row) return null;
    const p = (typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload) as { count?: number; resourceTypes?: string[] };
    return { at: String(row.created_at), count: p.count ?? 0, resourceTypes: p.resourceTypes ?? [] };
  };
  const activity = createActivityService({ runs: workflowRuns, batches: ingestBatches, persistedEvent });

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
  // Sync S3: pass referenceCapture so central terminology-metadata authoring (publishers /
  // coding_systems / term_mappings) lands rows in reference_change_log for labs to pull.
  const termAdmin = createTerminologyAdminStore(termDb, termProjection, referenceCapture);
  const termOntologyStore = createOntologyStore(termDb);
  const termOntology = createOntologyApi(termOntologyStore);
  const loaderStore: LoaderStore = {
    upsertConcepts: (r) => termStore.upsertConcepts(r),
    upsertMapElements: (r) => termStore.upsertMapElements(r),
    // Sync S3: loaders call this once at import completion; wire it to the bulk change signal.
    markSystemChanged: (url) => markTerminologyChanged(termDb, url),
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
    async ingestOntologyWithConcepts(systemType, systemId, dir, onProgress) {
      const url = canonicalSystemUrl(systemType);
      if (!url) throw new Error(`unsupported system type: ${systemType}`);
      let conceptsLoaded = 0;
      const conceptSink = async (rows: Parameters<LoaderStore['upsertConcepts']>[0]) => {
        await loaderStore.upsertConcepts(rows);
        conceptsLoaded += rows.length;
      };
      await buildOntologyDistribution(
        systemId, dir, termOntologyStore,
        (p) => onProgress({ phase: p.phase, processed: p.processed, total: p.total }),
        { conceptSink, expectedType: systemType as OntologyType },
      );
      // Registration tail — same as loadLoinc: make the terms queryable + fire the sync signal.
      const ref = await loaderStore.saveResource({ resourceType: 'CodeSystem', url, name: deriveSystemCode(url), status: 'active', content: 'not-present' });
      await loaderStore.saveSystem(url, null, 'CodeSystem', ref.id);
      await loaderStore.markSystemChanged(url);
      return { conceptsLoaded };
    },
  };

  // Task 6: terminology distribution ingest — job store (queue/claim/progress/retain-latest) +
  // the polling worker that drains it. `runIngest` streams+extracts the uploaded zip to a fresh
  // scratch dir per job (cleaned up unconditionally, including on a mid-extract throw — see
  // `downloadAndExtract`'s own note on why its returned `cleanup()` can't be relied on for that
  // case) and hands the extracted dir to the orchestrator, which loads flat concepts before
  // building the ontology tree over the same `terminology` context used by the admin routes.
  const terminologyJobs = createTerminologyIngestJobStore(internal.db);
  const terminologyWorkDirBase = cfg.TERMINOLOGY_WORK_DIR ?? tmpdir();
  const terminologyIngestWorker = createTerminologyIngestWorker({
    jobs: terminologyJobs,
    blob,
    audit,
    workDirBase: terminologyWorkDirBase,
    logger,
    runIngest: createRunIngest({ blob, terminology, workDirBase: terminologyWorkDirBase }),
  });

  const connectorStore = createConnectorStore(internal.db);
  const appSettings = createAppSettingsStore(internal.db, referenceCapture);
  const featureFlags = createFeatureFlags(appSettings);
  const numberSettings = createNumberSettings(appSettings);
  const validationStrictness: ValidationStrictness = createValidationStrictness(appSettings);
  const reportCategories = createReportCategoriesService(appSettings);
  const connectorSqlRunner = createConnectorSqlRunner({ connectors: connectorStore, secretsKey: cfg.SECRETS_ENCRYPTION_KEY });
  const connectorMongoRunner = createConnectorMongoRunner({ connectors: connectorStore, secretsKey: cfg.SECRETS_ENCRYPTION_KEY });
  const connectorRedisRunner = createConnectorRedisRunner({ connectors: connectorStore, secretsKey: cfg.SECRETS_ENCRYPTION_KEY });
  const connectorEmailRunner = createConnectorEmailRunner({ connectors: connectorStore, secretsKey: cfg.SECRETS_ENCRYPTION_KEY });
  const connectorSftpRunner = createConnectorSftpRunner({ connectors: connectorStore, secretsKey: cfg.SECRETS_ENCRYPTION_KEY });

  const workflowServices: WorkflowServices = {
    runSql: async (sql) => {
      const r = await dashboards.query({ mode: 'sql', sql });
      return { columns: r.columns.map((c) => ({ key: c.key, label: c.label })), rows: r.rows };
    },
    fhirQuery: async (resourceType, limit) => ({
      resources: (await termFhirStore.listByType(resourceType, limit)).map((x) => x.resource),
    }),
    httpFetch: (req) => guardedFetch(req, cfg.WORKFLOW_HTTP_ALLOWLIST),
    materializeDataset: async (name, columns, rows, workflowId) => {
      await workflowDatasets.upsertByName({ name, columns, rows, rowCount: rows.length, workflowId });
      if ((await featureFlags.get('workflow.dataset_publish_enabled')) && cfg.TARGET_STORE_ADAPTER === 'pg') {
        const table = datasetTableName(name);
        const ident = sql.table(table);
        await store.transaction(async (trx) => {
          await sql`drop table if exists ${ident}`.execute(trx);
          await sql`create table ${ident} (data jsonb not null)`.execute(trx);
          if (rows.length) {
            // Bound-parameter form: Kysely sends the JSON string as a parameter (no sql.lit).
            await sql`insert into ${ident} (data) select * from jsonb_array_elements(${JSON.stringify(rows)}::jsonb)`.execute(trx);
          }
        });
        await workflowDatasets.markPublished(name, table);
        return { dataset: name, rowCount: rows.length };
      }
      return { dataset: name, rowCount: rows.length };
    },
    loadDataset: async (name) => {
      const d = await workflowDatasets.getByName(name);
      if (!d) throw new Error(`Dataset not found: ${name}`);
      return { columns: d.columns, rows: d.rows };
    },
    exportArtifact: async ({ format, filename, title, columns, rows }) => {
      let bytes: Buffer;
      let contentType: string;
      const ext = format;
      if (format === 'pdf') {
        bytes = await renderReportPdf({ title: title ?? 'Workflow Export', generatedAt: new Date().toISOString(), params: {}, columns, rows });
        contentType = 'application/pdf';
      } else if (format === 'xlsx') {
        const data = rows.map((r) => Object.fromEntries(columns.map((c) => [c.label, r[c.key] ?? ''])));
        const ws = XLSX.utils.json_to_sheet(data);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Export');
        bytes = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
        contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      } else {
        bytes = Buffer.from(toCsv(columns, rows), 'utf8');
        contentType = 'text/csv';
      }
      const objectKey = `workflow-artifacts/${randomUUID()}/${filename ?? `export.${ext}`}`;
      await blob.put(objectKey, bytes, contentType);
      return { objectKey, format, byteSize: bytes.length };
    },
    readBinary: async (objectKey) => blob.get(objectKey),
    writeBinary: async ({ bytes, fileName, contentType }) => {
      if (bytes.byteLength > cfg.WORKFLOW_FILE_MAX_BYTES) {
        throw new Error(`file exceeds the ${cfg.WORKFLOW_FILE_MAX_BYTES}-byte limit`);
      }
      const safe = (fileName.split(/[\\/]/).pop() ?? 'output').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 128) || 'output';
      const objectKey = `workflow-artifacts/${randomUUID()}/${safe}`;
      await blob.put(objectKey, bytes, contentType);
      return { objectKey, contentType, fileName: safe, byteSize: bytes.byteLength };
    },
    runConnectorSql: (input) => connectorSqlRunner(input),
    runConnectorMongo: (input) => connectorMongoRunner(input),
    runConnectorRedis: (input) => connectorRedisRunner(input),
    runConnectorEmail: (input) => connectorEmailRunner(input),
    runConnectorSftp: (input) => connectorSftpRunner(input),
    resolveSecret: async ({ connectorId, key }) => {
      const config = await connectorStore.getDecryptedConfig(connectorId, cfg.SECRETS_ENCRYPTION_KEY);
      return config[key];
    },
    // SEC-06: open a sealed workflow-secret ref → plaintext (used by the HTTP node for a
    // ref-valued config.headers blob). Throws on unknown id / unset key (fail-closed).
    resolveWorkflowSecret: (ref) => workflowSecrets.resolve(ref, cfg.SECRETS_ENCRYPTION_KEY),
  };
  const workflowRunner = createWorkflowTriggerRunner({
    store: workflowStore, runs: workflowRuns, schedules: workflowSchedules,
    webhooks: workflowWebhooks, runWorkflow, logger,
    codeLimits: { timeoutMs: cfg.WORKFLOW_CODE_TIMEOUT_MS, memoryMb: cfg.WORKFLOW_CODE_MEMORY_MB, enabled: cfg.WORKFLOW_CODE_ENABLED },
    loopMaxItems: cfg.WORKFLOW_LOOP_MAX_ITEMS,
    services: workflowServices,
  });
  const workflowListeners = createWorkflowListenerManager({
    store: { list: () => workflowStore.list() },
    runAndRecord: (id, source, input, files) => workflowRunner.runAndRecord(id, source, input, files),
    logger,
    isEnabled: () => featureFlags.get('workflow.listeners_enabled'),
    drivers: {
      postgres: createPostgresListenerDriver({ connectors: connectorStore, secretsKey: cfg.SECRETS_ENCRYPTION_KEY, logger }),
      email: createEmailListenerDriver({
        connectors: connectorStore,
        secretsKey: cfg.SECRETS_ENCRYPTION_KEY,
        writeBinary: (i) => workflowServices.writeBinary!(i),
        logger,
        cfg,
      }),
    },
  });
  const workflows = { store: workflowStore, runs: workflowRuns, schedules: workflowSchedules, webhooks: workflowWebhooks, runner: workflowRunner, services: workflowServices, datasets: workflowDatasets, listeners: workflowListeners, secretStore: workflowSecrets };

  // SEC-06: proactively seal any PLAINTEXT secrets left inline in existing workflow definitions
  // (saved before SEC-06). Runs here — after the workflow store + secret store exist but BEFORE the
  // webhook registry's initial reconcile (apps/server boot loop's `webhooks.sync`) — so the registry
  // sees `{ secretRef }` values the injected resolver opens. Idempotent, key-guarded, and best-effort
  // per-workflow; like migrateLegacySyncConfig it must never abort boot.
  await migrateWorkflowSecrets({
    store: workflowStore,
    secretStore: workflowSecrets,
    key: cfg.SECRETS_ENCRYPTION_KEY,
    logger,
  }).catch((err) => logger.warn({ err }, 'SEC-06 workflow-secret migration failed'));

  // Restructure R2: async projection worker keeps the flat (external) store in sync with the
  // canonical FHIR store. A dedicated LISTEN client gives near-instant wakeups on `fhir_changes`
  // (emitted best-effort by fhirStore.save); interval polling is the correctness-bearing fallback
  // if the LISTEN connection can't be established (e.g. pooled/serverless PG), so a failure here
  // must never abort boot.
  const projectionListenClient = new pg.Client({ connectionString: cfg.INTERNAL_DATABASE_URL });
  let projectionListenConnected = true;
  try {
    await projectionListenClient.connect();
  } catch (e) {
    projectionListenConnected = false;
    logger.warn({ err: e }, 'projection worker: LISTEN client failed to connect; falling back to interval-only polling');
  }
  const projectionRunner = createProjectionRunner({
    internalDb: internal.db,
    fhirStore: canonicalFhirStore,
    relationalWriter: workflowRelationalWriter,
    logger,
    fetch: fetchSafeChangeRows,
  });
  const projectionWorker = createProjectionWorker({
    runCycle: () => projectionRunner.runCycle(),
    listenClient: projectionListenConnected ? projectionListenClient : undefined,
    logger,
  });

  // Sync S1: directional push (lab -> central). A SECOND consumer of fhir.change_log ('sync-push'),
  // config-gated. readSyncConfig returns null for any install that hasn't enabled + fully configured
  // sync (the default), in which case NOTHING here starts and boot is unaffected. The client secret is
  // decrypted with the same SECRETS_ENCRYPTION_KEY / open() scheme the connector store uses.
  // Sync S7-A: the quarantine store is built UNCONDITIONALLY — it only needs internal.db, and listing is
  // "just reads the table". A push-only node, a sync-disabled node, or a boot where readSyncConfig
  // degraded to disabled all still have durable quarantine rows from earlier boots, and an operator
  // looking for them must not be shown an empty list. Only the RETRY closure below is pull-gated (it
  // genuinely needs the terminology bulk-sync + a token provider).
  const syncQuarantine = createSyncQuarantineStore(internal.db);
  // Sync S7 (divergence detection): built UNCONDITIONALLY, like the quarantine store above.
  // applyRemote records a divergence row regardless of which workers started this boot, and an
  // operator on a push-only or sync-disabled node must still be able to list/clear them. (S7-A shipped
  // exactly this bug first: listQuarantine was hidden on non-pull nodes until the final review caught it.)
  const syncDivergences = createSyncDivergenceStore(internal.db);
  // S7 (A1): what each lab reports it has consumed. Built UNCONDITIONALLY, like the quarantine and
  // divergence stores beside it: the rows are durable and a later retention slice must read them on
  // any node. Nothing trims against them yet — this slice only records.
  const syncSiteCursors = createSyncSiteCursorStore(internal.db);
  const QUARANTINE_THRESHOLD = 3; // Sync S7-A: consecutive bulk-apply failures before quarantine
  const syncDecrypt = (blob: string): string => open(blob, parseSecretKey(cfg.SECRETS_ENCRYPTION_KEY ?? ''));
  // Symmetric seal/open pair exposed on AppContext so the sync settings route + CLI can write-encrypt
  // the client secret with the SAME key scheme syncDecrypt reads (open(seal(x,key),key) === x).
  const encryptSecret = (plain: string): string => seal(plain, parseSecretKey(cfg.SECRETS_ENCRYPTION_KEY ?? ''));
  // Reading the sync config touches app_settings; a transient DB read failure here must degrade to
  // "sync disabled" rather than abort boot (mirrors the projection LISTEN fallback's boot-safety).
  // One-time upgrade shim: pre-S4 installs kept sync config as a single JSON blob the workers never read.
  // Migrate it into the discrete sync.* keys BEFORE readSyncConfig runs so the reader sees the populated
  // keys. Best-effort — a failure here (transient DB) must warn, never abort boot.
  await migrateLegacySyncConfig(appSettings).catch((err) => {
    logger.warn({ err: (err as Error).message }, 'legacy sync config migration failed');
    return false;
  });
  // buildPush / buildPull (Task 3): construct — but do NOT start — the workers for a given config.
  // The SyncRuntime calls .start() after each builder returns and owns their stop()/listen-client
  // lifecycle, so these same closures rebuild the workers whenever reconcile() re-reads the config.
  //
  // makeShared builds the token provider + shared POST helper PER builder from the config. Two
  // provider instances (one per direction) is a benign change from the old single-shared instance:
  // each direction now caches its own client-credentials token instead of sharing one cache (both
  // still authenticate to the same central with the same client credentials).
  const makeShared = (syncCfg: SyncConfig) => {
    const tokenProvider = createSyncTokenProvider({
      issuerUrl: syncCfg.oidcIssuer,
      clientId: syncCfg.clientId,
      clientSecret: syncCfg.clientSecret,
    });
    // Shared POST helper: throws on non-2xx with the STATUS ONLY (never the bearer token).
    const postJson = async (url: string, body: unknown, token: string): Promise<unknown> => {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`central responded ${res.status}`); // status only — never the token
      return res.json();
    };
    return { tokenProvider, postJson };
  };

  // Track A — sync activity feed. A bounded, high-signal store of sync outcomes plus an in-memory
  // per-direction liveness tracker. Built ONCE, shared by both runners (via forDirection) and the
  // status handle (via summary). Emitting from the RUNNERS — not the routes — is the whole point.
  const syncActivity = createSyncActivityStore(internal.db, { retentionPerDirection: 200 });
  const syncActivityTracker = createSyncActivityTracker(syncActivity, logger);

  // PUSH direction (lab -> central). Runs for mode 'push' and 'bidirectional'.
  const buildPush = async (syncCfg: SyncConfig): Promise<BuiltPush> => {
    // Cadence is operator-configured (sync.interval_minutes); both directions share it.
    const intervalMs = syncCfg.intervalMinutes * 60_000;
    const { tokenProvider } = makeShared(syncCfg);
    // Sync S7-B: learned from central's RFC 7694 Accept-Encoding advert on each push response. Starts
    // false so the FIRST push is always plain — an old central never advertises and we never gzip it.
    // In-memory by design: it re-learns on the next response after a restart.
    let centralAcceptsGzip = false;
      const syncPushRunner = createSyncPushRunner({
        internalDb: internal.db,
        fetchSafeRows: fetchSafeChangeRows,
        // Upsert body for a specific origin version, read from the append-only history (the projection
        // safe-frontier has already confirmed this (type,id,version) committed + final before we push it).
        fetchContent: async (resourceType, id, version) => {
          const row = await internal.db
            .selectFrom('fhir.resource_history')
            .select('resource')
            .where('resource_type', '=', resourceType)
            .where('id', '=', id)
            .where('version', '=', version)
            .executeTakeFirst();
          return row?.resource ?? null;
        },
        postPush: async (batch: PushBatch, token: string): Promise<PushResponse> => {
          const json = JSON.stringify(batch);
          const { body, headers: encHeaders } = encodePushBody(json, centralAcceptsGzip);
          const res = await fetch(`${syncCfg.centralUrl}/api/sync/push`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...encHeaders },
            body,
          });
          // Learn central's capability from THIS response so subsequent pushes can compress.
          if (advertisesGzip(res.headers.get('accept-encoding'))) centralAcceptsGzip = true;
          // Throw (never leaking the token) so the runner leaves the cursor put and retries next cycle.
          if (!res.ok) throw new Error(`sync push POST /api/sync/push failed: central responded ${res.status}`);
          return (await res.json()) as PushResponse;
        },
        getToken: () => tokenProvider.getToken(),
        readCursor: () => readChangeCursor(internal.db, 'sync-push'),
        advanceCursor: (seq) => advanceChangeCursor(internal.db, 'sync-push', seq),
        logger,
        activity: syncActivityTracker.forDirection('push'),
      });
      // S7: a DEDICATED LISTEN client wakes the push drain the moment a resource is written, instead
      // of waiting up to sync.interval_minutes. Mirrors the projection worker's client (index.ts:704).
      // It must be its own connection — `pg` LISTEN on a pooled client is unreliable, and a missed
      // NOTIFY here degrades silently to interval-only (it still "works", just slowly).
      // Interval polling remains the correctness-bearing path: if this cannot connect (pooled or
      // serverless PG), push degrades to exactly the pre-S7 cadence rather than failing boot.
      const pushListenClient = new pg.Client({ connectionString: cfg.INTERNAL_DATABASE_URL });
      let pushListenConnected = true;
      try {
        await pushListenClient.connect();
      } catch (e) {
        pushListenConnected = false;
        logger.warn({ err: e }, 'sync push worker: LISTEN client failed to connect; falling back to interval-only polling');
      }
      const listenClient = pushListenConnected ? pushListenClient : undefined;
      const worker = createSyncPushWorker({
        runner: { runCycle: () => syncPushRunner.runCycle() },
        intervalMs,
        listenClient,
        logger,
      });
      // The runtime calls worker.start() — return it CONSTRUCTED-BUT-UNSTARTED.
      return { worker, listenClient };
  };

  // PULL direction (central -> lab reference config + terminology). Runs for mode 'pull' and
  // 'bidirectional'. A consumer of the change stream via its own 'sync-pull' cursor.
  const buildPull = async (syncCfg: SyncConfig): Promise<BuiltPull> => {
    const intervalMs = syncCfg.intervalMinutes * 60_000;
    const { tokenProvider, postJson } = makeShared(syncCfg);
      // S3 terminology bulk-sync: a signalled terminology_system/concept_map record triggers a whole-system /
      // whole-map keyset drain + reconcile (all-or-nothing; THROWS on any failure so the runner holds the cursor).
      const termBulk = createTerminologyBulkSync({
        labDb: internal.db,
        getToken: () => tokenProvider.getToken(),
        fetchConceptsPage: async (systemUrl, afterCode, token) =>
          (await postJson(
            `${syncCfg.centralUrl}/api/sync/terminology/concepts`,
            { systemUrl, afterCode: afterCode ?? undefined },
            token,
          )) as import('@openldr/sync').ConceptsPage,
        fetchMapElementsPage: async (mapUrl, afterKey, token) =>
          (await postJson(
            `${syncCfg.centralUrl}/api/sync/terminology/map-elements`,
            { mapUrl, afterSourceSystem: afterKey?.sourceSystem, afterSourceCode: afterKey?.sourceCode },
            token,
          )) as import('@openldr/sync').MapElementsPage,
        logger,
      });

      // Pull worker: mirror central's reference config down. Shares the token provider + internal db.
      // Dispatcher: terminology signals route to the bulk-sync (whole-system/map drain); every other kind is a
      // per-row reference apply. The runner's default isHoldRecord already holds the two terminology kinds.
      const referenceApplier = createReferenceApplier(internal.db);
      const applyRecord = async (rec: import('@openldr/sync').PullRecord): Promise<'applied' | 'skipped'> => {
        if (rec.entityType === 'terminology_system') {
          await termBulk.syncSystem(rec.entityId, rec.body);
          return 'applied';
        }
        if (rec.entityType === 'concept_map') {
          await termBulk.syncConceptMap(rec.entityId, rec.body);
          return 'applied';
        }
        return referenceApplier(rec);
      };
      const quarantine = syncQuarantine;
      // Sync S7-A: targeted re-sync of a quarantined bulk entity, independent of the advanced cursor.
      // See sync-retry-quarantine.ts for the (test-pinned) refuse-untracked / replay-descriptor /
      // clear-only-on-success contract. Rides on the PULL result (the runtime exposes it via retryQuarantine()).
      const retryQuarantine = createRetryQuarantine({ quarantine, termBulk, threshold: QUARANTINE_THRESHOLD });
      const syncPullRunner = createSyncPullRunner({
        getToken: () => tokenProvider.getToken(), // SHARE the token provider instance
        applyRecord,
        postPull: async (body, token) =>
          (await postJson(`${syncCfg.centralUrl}/api/sync/pull`, body, token)) as import('@openldr/sync').PullResponse,
        readCursor: () => readChangeCursor(internal.db, 'sync-pull'),
        advanceCursor: (seq) => advanceChangeCursor(internal.db, 'sync-pull', seq),
        holdFailure: (rec, err) =>
          quarantine
            .recordFailure(rec.entityType, rec.entityId, {
              seq: rec.seq,
              error: err.message,
              // Persist central's descriptor so a manual retry replays the REAL identity/generation.
              body: rec.body,
              threshold: QUARANTINE_THRESHOLD,
            })
            .then((r) => (r.status === 'quarantined' ? 'quarantine' : 'hold')),
        holdSuccess: (rec) => quarantine.clear(rec.entityType, rec.entityId),
        logger,
        activity: syncActivityTracker.forDirection('pull'),
      });
      // Sync S6a: the amendment pull runner — a SECOND stream drained in the same host loop, over its own
      // 'sync-amend-pull' cursor. Wire = SyncRecord (same as push), applied via applyRemote (higher
      // version wins, idempotent). canonicalFhirStore is the same store the server exposes as ctx.fhirStore.
      const amendmentPullRunner = createAmendmentPullRunner({
        getToken: () => tokenProvider.getToken(), // SHARE the token provider instance
        postPull: async (body, token) =>
          (await postJson(`${syncCfg.centralUrl}/api/sync/pull-amendments`, body, token)) as import('@openldr/sync').AmendmentPullResponse,
        applyRecord: (rec) => canonicalFhirStore.applyRemote(rec),
        readCursor: () => readChangeCursor(internal.db, 'sync-amend-pull'),
        advanceCursor: (seq) => advanceChangeCursor(internal.db, 'sync-amend-pull', seq),
        logger,
        activity: syncActivityTracker.forDirection('amend'),
      });
      const worker = createSyncPullWorker({
        runner: {
          // One host loop drains BOTH downward streams per cycle: reference config first, then
          // amendments. Each runner owns its cursor + failure model. combineCycleResults (S7) folds
          // the two outcomes: 'progressed' wins so a healthy stream keeps draining while a sick one
          // only logs; 'failed' beats 'drained' so one sick stream never reads as caught up.
          runCycle: async () => {
            const ref = await syncPullRunner.runCycle();
            const amend = await amendmentPullRunner.runCycle();
            return combineCycleResults(ref, amend);
          },
        },
        intervalMs,
        logger,
      });
      // The runtime calls worker.start() — return it CONSTRUCTED-BUT-UNSTARTED, with the retry
      // closure (the runtime exposes it via retryQuarantine()).
      return { worker, retryQuarantine };
  };

  // Sync (Task 3): the runtime drives worker construction from a freshly-read config on every
  // reconcile(). readConfig degrades a transient app_settings read failure to "sync disabled" rather
  // than aborting boot (preserving the pre-refactor try/catch); buildPush/buildPull do the mode-gated
  // construction the old inline `if (syncCfg)` block used to. reconcile() starts whichever workers the
  // mode calls for; stop() (in close() below) tears them down.
  const syncRuntime = createSyncRuntime({
    logger,
    readConfig: async () => {
      try {
        return await readSyncConfig(appSettings, syncDecrypt, logger);
      } catch (err) {
        logger.warn({ err }, 'sync push worker: could not read sync config; sync disabled this boot');
        return null;
      }
    },
    buildPush,
    buildPull,
  });
  await syncRuntime.reconcile(); // initial start (replaces the old inline if (syncCfg) block)

  // Sync S4: expose a status/trigger handle over the runtime. Always present — a disabled node
  // reports enabled:false + null directions and triggerNow() is a no-op.
  const sync = createSyncHandle({
    db: internal.db,
    runtime: syncRuntime,
    quarantine: syncQuarantine,
    divergences: syncDivergences,
    activity: syncActivityTracker,
  });

  const pluginData = createPluginDataStore(internal.db);
  // Generic, caller-driven DHIS2 push orchestration (mapping/orgUnitMap supplied by the
  // plugin UI through the broker). Mirrors the host dhis2-context runMapping behaviour.
  const dhis2Orch = createDhis2Orchestration({
    connectors: connectorStore,
    loadSink: (id, v) => plugins.loadSink(id, v),
    reporting: {
      run: (id, params) => reporting.run(id, params).then((r) => ({ rows: (r as { rows: Record<string, unknown>[] }).rows })),
      runEventSource: (id, w) => reporting.runEventSource(id, w).then((r) => ({ rows: (r as { rows: Record<string, unknown>[] }).rows })),
    },
    createTarget: createPluginTarget,
    secretsKey: cfg.SECRETS_ENCRYPTION_KEY,
    pluginData,
    audit,
    logger,
  });
  // Generic per-plugin schedule store + host runner (fires plugin schedules headlessly;
  // for DHIS2 it drives the orchestration push). Completes the broker's deferred `schedules` dep.
  const pluginScheduleRunner = createPluginScheduleRunner({ pluginData, push: (input) => dhis2Orch.push(input), logger });

  // Generic plugin-node executor: resolves the node's plugin + connector, enforces capabilities,
  // and invokes the wasm {items,config} entrypoint. Mutates the same workflowServices object the
  // runner already references (set post-construction), so plugin-node handlers resolve it at run time.
  workflowServices.runPluginNode = createPluginNodeService({
    plugins,
    connectors: connectorStore,
    secretsKey: cfg.SECRETS_ENCRYPTION_KEY,
    policy: () => ({ egressEnabled: cfg.PLUGIN_EGRESS_ENABLED }),
    blob,
    maxFileBytes: cfg.WORKFLOW_FILE_MAX_BYTES,
  });
  workflowServices.validateForm = createFormValidateService({ forms });
  workflowServices.persistStore = createPersistStoreService({
    persist: workflowPersist,
    publish: (event) => eventing.publish(event),
    newId: () => randomUUID(),
  });
  // Execute Workflow node: run another saved workflow as a sub-workflow. Re-enters the
  // runner with the recursion chain extended (cycle + depth guard) and returns the
  // sub-run's terminal (leaf-node) items so the parent flow can chain onward.
  workflowServices.runSubWorkflow = async ({ workflowId, input, callStack }) => {
    assertSubWorkflowAllowed(workflowId, callStack);
    const rec = await workflowStore.get(workflowId);
    if (!rec) throw new Error(`Execute Workflow: unknown workflow: ${workflowId}`);
    const def = WorkflowDefinitionSchema.parse(rec.definition);
    const result = await runWorkflow(def.nodes, def.edges, {
      input,
      services: workflowServices,
      codeLimits: { timeoutMs: cfg.WORKFLOW_CODE_TIMEOUT_MS, memoryMb: cfg.WORKFLOW_CODE_MEMORY_MB, enabled: cfg.WORKFLOW_CODE_ENABLED },
      loopMaxItems: cfg.WORKFLOW_LOOP_MAX_ITEMS,
      workflowId,
      callStack: [...callStack, workflowId],
    });
    if (result.status === 'failed') {
      const failed = result.results.find((r) => r.status === 'error');
      throw new Error(`Execute Workflow: sub-workflow ${workflowId} failed: ${failed?.error ?? 'unknown error'}`);
    }
    return { items: extractTerminalItems(def.edges, result.results), status: result.status };
  };
  const hostFiles = createHostFileService({
    enabled: cfg.WORKFLOW_FILE_ACCESS_ENABLED,
    root: cfg.WORKFLOW_FILE_ACCESS_ROOT,
    maxBytes: cfg.WORKFLOW_FILE_MAX_BYTES,
  });
  workflowServices.hostFileRead = hostFiles.hostFileRead;
  workflowServices.hostFileWrite = hostFiles.hostFileWrite;
  workflowServices.hostFileList = hostFiles.hostFileList;
  workflowServices.hostFileDelete = hostFiles.hostFileDelete;
  const pluginBroker = createPluginBroker({
    plugins,
    pluginData,
    schedules: createPluginScheduleApi(pluginData),
    reporting: {
      list: () => reporting.listAll(),
      columns: (id) => reporting.run(id, {}).then((r) => (r as { columns: unknown }).columns),
      run: (id, params) => reporting.run(id, params),
      eventSources: () => reporting.eventSources(),
    },
    connectors: connectorStore,
    connectorMetadata: (id) => dhis2Orch.metadata(id),
    connectorPush: (input) => dhis2Orch.push(input),
    connectorValidate: (input) => dhis2Orch.validate(input),
    // FHIR Location facilities for the org-unit mapping screen ({ id, name }[]).
    facilities: async () =>
      (await termFhirStore.listByType('Location')).map((l) => {
        const r = (l.resource ?? l) as { id?: string; name?: string };
        return { id: r.id, name: r.name ?? r.id };
      }),
    // Live connector test: decrypt config → load sink → health_check + pull_metadata.
    // Throws on any failure; the broker catches, logs detail server-side, and returns
    // a generic error to the (untrusted) plugin so credentials in errors never reach the iframe.
    testConnector: async (id: string) => {
      const c = await connectorStore.get(id);
      if (!c || !c.enabled) throw new Error(`connector ${id} not found or disabled`);
      const config = await connectorStore.getDecryptedConfig(id, cfg.SECRETS_ENCRYPTION_KEY);
      if (!c.pluginId) throw new Error(`connector ${id} is not a plugin connector`);
      const sink = await plugins.loadSink(c.pluginId);
      if (!sink) throw new Error(`sink plugin ${c.pluginId} is not installed`);
      const target = createPluginTarget(sink, config, c.allowedHost);
      const health = await target.healthCheck();
      if (health.status !== 'up') throw new Error(health.detail ?? 'unreachable');
      const md = await target.pullMetadata();
      return {
        ok: true,
        metadata: {
          dataElements: md.dataElements.length,
          orgUnits: md.orgUnits.length,
          categoryOptionCombos: md.categoryOptionCombos.length,
          programs: md.programs?.length ?? 0,
          programStages: md.programStages?.length ?? 0,
        },
      };
    },
    logger,
    maxDocBytes: cfg.PLUGIN_DATA_MAX_DOC_BYTES,
    policy: () => policyFromConfig(cfg),
    // Audit the broker's security boundary: every denial (capability/role/policy/egress gate or a
    // malformed op) and every completed sensitive op (wasm invoke / live egress). High-frequency
    // reads (storage/reports/fhir/list) are not emitted. safeRecord is best-effort (never throws).
    audit: (e) => safeRecord(audit, logger, {
      actorType: 'user', actorId: e.principal.id, actorName: e.principal.username ?? e.principal.id,
      action: e.outcome === 'denied' ? 'plugin.broker.denied' : 'plugin.broker.access',
      entityType: 'plugin', entityId: e.pluginId,
      metadata: { op: e.op, outcome: e.outcome, roles: e.principal.roles, ...(e.reason ? { reason: e.reason } : {}) },
    }),
  });

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
    pluginScheduleRunner,
    users,
    roles,
    userProfiles,
    forms,
    marketplaceForms,
    reporting,
    health,
    terminology,
    dashboards,
    reportDesigns: reportDesignStore,
    reportDefs: reportDefStore,
    reportCategories,
    syncSites,
    syncSiteCursors,
    workflows,
    plugins,
    pluginData,
    pluginBroker,
    connectors: connectorStore,
    appSettings,
    featureFlags,
    numberSettings,
    validationStrictness,
    activity,
    encryptSecret,
    decryptSecret: syncDecrypt,
    sync,
    syncActivity,
    syncRuntime,
    terminologyJobs,
    cfg,
    async close() {
      await workflowListeners.stopAll();
      // The runtime stops both workers and ends the push LISTEN client it owns.
      await syncRuntime.stop();
      await projectionWorker.stop();
      await terminologyIngestWorker.stop();
      if (projectionListenConnected) await projectionListenClient.end().catch(() => undefined);
      await Promise.allSettled([eventing.close(), store.close(), internal.close()]);
    },
  };
}

export { createFeatureFlags } from './feature-flags';
export type { FeatureFlags, ResolvedFlag } from './feature-flags';
export { createNumberSettings } from './number-settings';
export type { NumberSettings, ResolvedNumberSetting } from './number-settings';
export { createReportCategoriesService, REPORT_CATEGORIES_SETTING_KEY } from './report-categories';
export type { ReportCategoriesService } from './report-categories';
export { createActivityService } from './activity-service';
export type { ActivityService, RecentPayload } from './activity-service';
export { getSyncConfig, setSyncConfig, readSigningKeys } from './sync-settings';
export {
  servePull,
  serveAmendments,
  serveConceptsPage,
  serveMapElementsPage,
  drainConcepts,
  drainMapElements,
} from './sync-serve';
export {
  exportPushBundle,
  importPushBundle,
  exportPullBundle,
  importPullBundle,
  BundleSignatureError,
  BundleGapError,
} from './sync-bundle';
export { createSyncHandle } from './sync-handle';
export type { SyncHandle, SyncStatus, SyncDirectionStatus, SyncMode } from './sync-handle';
export { migrateLegacySyncConfig } from './sync-settings-migrate';
export { sealDefinitionSecrets } from './workflow-secret-seal';
export { migrateWorkflowSecrets } from './workflow-secret-migrate';
export { mergePatients } from './patient-merge';
export {
  enrollSite,
  listSites,
  rotateSite,
  revokeSite,
  ensureCentralKeypair,
  AlreadyEnrolledError,
  SiteNotFoundError,
  InvalidSiteIdError,
  MissingCentralUrlError,
} from './enrollment';
export type { EnrollResult } from './enrollment';
export { CE_VERSION } from './plugin-registry';
export * from './db-context';
export { createPluginTarget } from './connector-target';
export { createConnectorDb, type ConnectorDb } from './connector-db';
export { testConnector } from './connector-test';
export * from './ingest-context';
export * from './target-store';
export * from './terminology-context';
export * from './s3-config';
export * from './terminology-ingest-shared';
export * from './terminology-ingest-worker';
export * from './seed';
export * from './plugin-broker';
export * from './crash-audit';
export * from './crash-loop';
export * from './policy';
export { wipeInternalDatabase, clearAuditAndRunHistory, listInternalDataTables, buildTruncateSql } from './danger';
export { recordAuditEvent } from './record-audit';
export type { AuditActor, AuditDetails } from './record-audit';
export {
  listNotifications, markNotificationsRead, markAllNotificationsRead,
  getNotificationPrefs, saveNotificationPrefs,
  syncRowToNotification, auditRowToNotification, passesPrefs, PRIORITY_RANK,
} from './notifications';
export type { Notification, NotificationType, NotificationPriority, NotificationPreference, NotificationCtx } from './notifications';

/** Delete all dashboards and restore the built-in sample. Internal DB only. */
export async function dangerResetDashboards(ctx: AppContext): Promise<void> {
  for (const d of await ctx.dashboards.store.list()) await ctx.dashboards.store.remove(d.id);
  await seedDefaultDashboard(ctx.dashboards.store);
}

/** Empty the audit log + workflow run history. Internal DB only. */
export async function dangerClearAudit(ctx: AppContext): Promise<void> {
  await clearAuditAndRunHistory(ctx.internalDb);
}

/** Wipe ALL internal-DB data and reseed factory defaults. Never touches the external target
 *  store or Keycloak. Reseed uses a fresh DbContext exactly like the SEED_ON_START boot path. */
export async function dangerFactoryReset(ctx: AppContext): Promise<void> {
  const wiped = await wipeInternalDatabase(ctx.internalDb);
  ctx.logger.warn({ tables: wiped.length }, 'factory reset: internal DB wiped, reseeding');
  const dbCtx = await createDbContext(ctx.cfg);
  try {
    await seedDatabase(dbCtx, ctx);
  } finally {
    await dbCtx.close();
  }
  // Admin-lockout guard: wipeInternalDatabase() TRUNCATEs roles/role_capabilities/user_roles
  // along with everything else, and seedDatabase() deliberately does NOT reseed roles (that
  // seed is routed through createAppContext's unconditional boot-time call — see the comment
  // beside `const roles = createRoleStore(internal.db)` above). Without this call a live server
  // would be left with zero roles — and once RBAC enforcement lands, nobody holding
  // `roles.manage` — until the process restarts. seedSystemRoles() is idempotent, so calling it
  // here is safe even though createAppContext already seeded it once at boot.
  await ctx.roles.seedSystemRoles();
  ctx.featureFlags.invalidate();
}
