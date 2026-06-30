import { randomUUID } from 'node:crypto';
import * as XLSX from 'xlsx';
import { Kysely, sql } from 'kysely';
import { createAuth } from '@openldr/adapter-auth';
import { createEventBus } from '@openldr/adapter-event-bus';
import { createS3Bucket } from '@openldr/adapter-s3-bucket';
import type { Config } from '@openldr/config';
import { createLogger, HealthRegistry, redact, type Logger } from '@openldr/core';
import { createInternalDb, createFhirStore, createFlatWriter, persistResources, createTerminologyStore, createTerminologyAdminStore, createOntologyStore, createReportRunStore, createReportScheduleStore, createMarketplaceInstallStore, createRegistryStore, deriveSystemCode, resolveSeedPublisherId, type TerminologyAdminStore, type OntologyStore, type FhirStore, type ReportRunStore, type ReportScheduleStore } from '@openldr/db';
import type { ExternalSchema, InternalSchema, Provenance } from '@openldr/db';
import type { AuthPort, BlobStoragePort, EventingPort, TargetStorePort } from '@openldr/ports';
import { createAuditStore, safeRecord, type AuditStore } from '@openldr/audit';
import { createUserStore, type UserStore, createUserProfileStore, type UserProfileStore } from '@openldr/users';
import { createFormStore, type FormStore } from '@openldr/forms';
import { getReport, reportSummaries, getEventSource, eventSourceCatalog, toCsv, type ReportResult, type ReportSummary } from '@openldr/reporting';
import { createDashboardStore, getModel, listModels, runBuilderQuery, runSqlQuery, type DashboardStore, type WidgetQuery } from '@openldr/dashboards';
import {
  createWorkflowStore, type WorkflowStore,
  createWorkflowRunStore, type WorkflowRunStore,
  createWorkflowScheduleStore, type WorkflowScheduleStore,
  createWebhookRegistry, type WebhookRegistry,
  createWorkflowTriggerRunner, type WorkflowTriggerRunner,
  createWorkflowDatasetStore, type WorkflowDatasetStore,
  runWorkflow,
  guardedFetch, type WorkflowServices,
} from '@openldr/workflows';
import { renderReportPdf } from '@openldr/report-pdf';
import { createReportScheduler, type ReportScheduler } from './report-scheduler';
import { createPluginScheduleApi, createPluginScheduleRunner, type PluginScheduleRunner } from './plugin-schedule';
import { createFormArtifactInstaller, type FormArtifactInstaller } from './form-artifact-install';
import { type PluginRuntime } from '@openldr/plugins';
import { createConnectorStore, createPluginDataStore, type PluginDataStore } from '@openldr/db';
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
import { createDhis2Orchestration } from './dhis2-orchestration';
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
  };
  dashboards: DashboardsApi;
  workflows: {
    store: WorkflowStore;
    runs: WorkflowRunStore;
    schedules: WorkflowScheduleStore;
    webhooks: WebhookRegistry;
    runner: WorkflowTriggerRunner;
    services: WorkflowServices;
    datasets: WorkflowDatasetStore;
  };
  plugins: PluginRuntime;
  pluginData: PluginDataStore;
  pluginBroker: PluginBroker;
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
  const { store, engine } = selectTargetStore(cfg);
  const externalDb = store.db as unknown as Kysely<ExternalSchema>;
  const internal = createInternalDb(cfg.INTERNAL_DATABASE_URL);
  const audit = createAuditStore(internal.db);
  const reportRuns = createReportRunStore(internal.db);
  const reportSchedules = createReportScheduleStore(internal.db);
  const plugins = createPluginRegistry({ blob, internalDb: internal.db, logger, audit, devAllowUnsigned: cfg.MARKETPLACE_DEV_ALLOW_UNSIGNED });
  const users = createUserStore(internal.db);
  const userProfiles = createUserProfileStore(internal.db);
  const forms = createFormStore(internal.db);
  const marketplaceInstalls = createMarketplaceInstallStore(internal.db);

  // Canonical persist for the Persist Store workflow node — same wiring as ingest-context.
  const canonicalFhirStore = createFhirStore(internal.db);
  const workflowFlatWriter = createFlatWriter(externalDb, engine);
  const workflowPersist = (resources: unknown[], prov: Provenance) =>
    persistResources({ fhirStore: canonicalFhirStore, flatWriter: workflowFlatWriter, logger }, resources, prov);
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
  const runReport = async (id: string, rawParams: unknown): Promise<ReportResult> => {
    const def = getReport(id);
    if (!def) throw new ReportNotFoundError(id);
    // Defense-in-depth: report param schemas are z.object(...) which throw "Required" on undefined.
    // "No params" is a valid input (all report fields are optional) → normalise undefined/null to {}.
    // The DHIS2 push path (dispatchReportSource) is the source fix; this guards every other caller.
    const params = def.params.parse(rawParams ?? {});
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
  const workflowDatasets = createWorkflowDatasetStore(internal.db);

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

  const connectorStore = createConnectorStore(internal.db);
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
      if (cfg.WORKFLOW_DATASET_PUBLISH_ENABLED && cfg.TARGET_STORE_ADAPTER === 'pg') {
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
  };
  const workflowRunner = createWorkflowTriggerRunner({
    store: workflowStore, runs: workflowRuns, schedules: workflowSchedules,
    webhooks: workflowWebhooks, runWorkflow, logger,
    codeLimits: { timeoutMs: cfg.WORKFLOW_CODE_TIMEOUT_MS, memoryMb: cfg.WORKFLOW_CODE_MEMORY_MB, enabled: cfg.WORKFLOW_CODE_ENABLED },
    services: workflowServices,
  });
  const workflows = { store: workflowStore, runs: workflowRuns, schedules: workflowSchedules, webhooks: workflowWebhooks, runner: workflowRunner, services: workflowServices, datasets: workflowDatasets };

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
  const pluginBroker = createPluginBroker({
    plugins,
    pluginData,
    schedules: createPluginScheduleApi(pluginData),
    reporting: {
      list: () => reporting.list(),
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
    userProfiles,
    forms,
    marketplaceForms,
    reporting,
    health,
    terminology,
    dashboards,
    workflows,
    plugins,
    pluginData,
    pluginBroker,
    cfg,
    async close() {
      await Promise.allSettled([eventing.close(), store.close(), internal.close()]);
    },
  };
}

export { CE_VERSION } from './plugin-registry';
export * from './db-context';
export { createPluginTarget } from './connector-target';
export { createConnectorDb, type ConnectorDb } from './connector-db';
export { testConnector } from './connector-test';
export * from './ingest-context';
export * from './target-store';
export * from './terminology-context';
export * from './seed';
export * from './plugin-broker';
export * from './crash-audit';
export * from './policy';
