import { Kysely } from 'kysely';
import { createAuth } from '@openldr/adapter-auth';
import { createDbStore } from '@openldr/adapter-db-store';
import { createEventBus } from '@openldr/adapter-event-bus';
import { createS3Bucket } from '@openldr/adapter-s3-bucket';
import type { Config } from '@openldr/config';
import { createLogger, HealthRegistry, type Logger } from '@openldr/core';
import { createInternalDb } from '@openldr/db';
import type { ExternalSchema } from '@openldr/db';
import type { AuthPort, BlobStoragePort, EventingPort, TargetStorePort } from '@openldr/ports';
import { createAuditStore, type AuditStore } from '@openldr/audit';
import { createUserStore, type UserStore } from '@openldr/users';
import { getReport, reportSummaries, type ReportResult, type ReportSummary } from '@openldr/reporting';

export class ReportNotFoundError extends Error {
  constructor(public readonly id: string) {
    super(`unknown report: ${id}`);
    this.name = 'ReportNotFoundError';
  }
}

export interface ReportingApi {
  list(): ReportSummary[];
  run(id: string, rawParams: unknown): Promise<ReportResult>;
}

export interface AppContext {
  logger: Logger;
  auth: AuthPort;
  blob: BlobStoragePort;
  eventing: EventingPort;
  store: TargetStorePort;
  audit: AuditStore;
  users: UserStore;
  reporting: ReportingApi;
  health: HealthRegistry;
  close(): Promise<void>;
}

export async function createAppContext(cfg: Config): Promise<AppContext> {
  const logger = createLogger({ level: cfg.LOG_LEVEL });

  const auth = createAuth({ issuerUrl: cfg.OIDC_ISSUER_URL });
  const blob = createS3Bucket({
    endpoint: cfg.S3_ENDPOINT,
    region: cfg.S3_REGION,
    accessKeyId: cfg.S3_ACCESS_KEY_ID,
    secretAccessKey: cfg.S3_SECRET_ACCESS_KEY,
    bucket: cfg.S3_BUCKET,
    forcePathStyle: cfg.S3_FORCE_PATH_STYLE,
  });
  const eventing = createEventBus({ url: cfg.INTERNAL_DATABASE_URL });
  const store = createDbStore({ url: cfg.TARGET_DATABASE_URL! });
  const internal = createInternalDb(cfg.INTERNAL_DATABASE_URL);
  const audit = createAuditStore(internal.db);
  const users = createUserStore(internal.db);
  const reportingDb = store.db as unknown as Kysely<ExternalSchema>;
  const reporting: ReportingApi = {
    list: () => reportSummaries(),
    async run(id, rawParams) {
      const def = getReport(id);
      if (!def) throw new ReportNotFoundError(id);
      const params = def.params.parse(rawParams);
      const data = await def.run(reportingDb, params);
      return { ...data, meta: { generatedAt: new Date().toISOString(), rowCount: data.rows.length } };
    },
  };

  const health = new HealthRegistry();
  health.register({ name: 'auth', check: () => auth.healthCheck() });
  health.register({ name: 'blob', check: () => blob.healthCheck() });
  health.register({ name: 'eventing', check: () => eventing.healthCheck() });
  health.register({ name: 'target-store', check: () => store.healthCheck() });

  return {
    logger,
    auth,
    blob,
    eventing,
    store,
    audit,
    users,
    reporting,
    health,
    async close() {
      await Promise.allSettled([eventing.close(), store.close(), internal.close()]);
    },
  };
}

export * from './db-context';
export * from './ingest-context';
