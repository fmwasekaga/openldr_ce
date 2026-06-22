import { Kysely } from 'kysely';
import { createS3Bucket } from '@openldr/adapter-s3-bucket';
import { createEventBus } from '@openldr/adapter-event-bus';
import type { Config } from '@openldr/config';
import { createLogger } from '@openldr/core';
import {
  createInternalDb,
  createFhirStore,
  createFlatWriter,
  createMigrator,
  persistResources,
  internalMigrations,
  externalMigrations,
  type ExternalSchema,
  type Provenance,
} from '@openldr/db';
import {
  acceptPayload,
  handleIngestEvent,
  defaultConverters,
  createBatchStore,
  registryResolver,
  chainResolvers,
  type AcceptInput,
  type BatchStore,
  type Converter,
} from '@openldr/ingest';
import { type PluginRuntime } from '@openldr/plugins';
import { createAuditStore, safeRecord } from '@openldr/audit';
import { createPluginRegistry } from './plugin-registry';
import type { EventingPort } from '@openldr/ports';
import { selectTargetStore } from './target-store';

export interface IngestContext {
  accept(input: AcceptInput): Promise<{ batchId: string; blobKey: string }>;
  drain(): Promise<{ processed: number; failed: number }>;
  startWorker(): { stop(): Promise<void> };
  batches: BatchStore;
  plugins: PluginRuntime;
  eventing: EventingPort;
  republish(batch: { batch_id: string; blob_key: string; source: string | null; converter: string; config?: Record<string, string> | null }): Promise<void>;
  queueStats(): Promise<Record<string, number>>;
  migrateAll(): Promise<void>;
  close(): Promise<void>;
}

export async function createIngestContext(cfg: Config): Promise<IngestContext> {
  const logger = createLogger({ level: cfg.LOG_LEVEL });
  const internal = createInternalDb(cfg.INTERNAL_DATABASE_URL);
  const { store: externalStore, engine } = selectTargetStore(cfg);
  const externalDb = externalStore.db as unknown as Kysely<ExternalSchema>;
  const blob = createS3Bucket({
    endpoint: cfg.S3_ENDPOINT,
    region: cfg.S3_REGION,
    accessKeyId: cfg.S3_ACCESS_KEY_ID,
    secretAccessKey: cfg.S3_SECRET_ACCESS_KEY,
    bucket: cfg.S3_BUCKET,
    forcePathStyle: cfg.S3_FORCE_PATH_STYLE,
  });
  const eventing = createEventBus({ url: cfg.INTERNAL_DATABASE_URL });

  const fhirStore = createFhirStore(internal.db);
  const flatWriter = createFlatWriter(externalDb, engine);
  const persist = (resources: unknown[], provenance: Provenance) => persistResources({ fhirStore, flatWriter, logger }, resources, provenance);
  const converters = defaultConverters();
  const batches = createBatchStore(internal.db);
  const audit = createAuditStore(internal.db);

  const plugins = createPluginRegistry({ blob, internalDb: internal.db, logger, audit, devAllowUnsigned: cfg.MARKETPLACE_DEV_ALLOW_UNSIGNED });

  const pluginResolver = { resolve: (id: string): Promise<Converter | undefined> => plugins.load(id) };
  const resolver = chainResolvers(registryResolver(converters), pluginResolver);

  await eventing.subscribe('ingest.received', (event) =>
    handleIngestEvent(
      {
        blob, persist, resolver, batches, logger,
        audit: (e) => safeRecord(audit, logger, e),
        onBatchDone: (info) => eventing.publish({ type: 'ingest.batch.done', payload: info }),
      },
      event,
    ),
  );

  const internalMigrator = createMigrator(internal.db, internalMigrations);
  const externalMigrator = createMigrator(externalDb, externalMigrations(engine));

  return {
    accept: (input) => acceptPayload({ blob, eventing, batches, logger }, input),
    drain: () => eventing.drain(),
    startWorker: () => eventing.startWorker(),
    batches,
    eventing,
    plugins,
    async republish(batch) {
      await eventing.publish({ type: 'ingest.received', payload: { batchId: batch.batch_id, blobKey: batch.blob_key, source: batch.source ?? 'cli', converter: batch.converter, config: batch.config ?? null } });
    },
    queueStats: () => eventing.stats(),
    async migrateAll() {
      await internalMigrator.migrateToLatest();
      await externalMigrator.migrateToLatest();
    },
    async close() {
      await Promise.allSettled([internal.close(), externalStore.close(), eventing.close()]);
    },
  };
}
