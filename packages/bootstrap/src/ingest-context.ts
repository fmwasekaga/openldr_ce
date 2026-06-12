import { Kysely } from 'kysely';
import { createDbStore } from '@openldr/adapter-db-store';
import { createS3Bucket } from '@openldr/adapter-s3-bucket';
import { createEventBus } from '@openldr/adapter-event-bus';
import type { Config } from '@openldr/config';
import { createLogger } from '@openldr/core';
import {
  createInternalDb,
  createFhirStore,
  createFlatWriter,
  createMigrator,
  persistResource,
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
  type AcceptInput,
  type BatchStore,
} from '@openldr/ingest';

export interface IngestContext {
  accept(input: AcceptInput): Promise<{ batchId: string; blobKey: string }>;
  drain(): Promise<{ processed: number; failed: number }>;
  startWorker(): { stop(): Promise<void> };
  batches: BatchStore;
  republish(batch: { batch_id: string; blob_key: string; source: string | null; converter: string }): Promise<void>;
  queueStats(): Promise<Record<string, number>>;
  migrateAll(): Promise<void>;
  close(): Promise<void>;
}

export async function createIngestContext(cfg: Config): Promise<IngestContext> {
  const logger = createLogger({ level: cfg.LOG_LEVEL });
  const internal = createInternalDb(cfg.INTERNAL_DATABASE_URL);
  const externalStore = createDbStore({ url: cfg.TARGET_DATABASE_URL });
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
  const flatWriter = createFlatWriter(externalDb);
  const persist = (resource: unknown, provenance: Provenance) => persistResource({ fhirStore, flatWriter, logger }, resource, provenance);
  const converters = defaultConverters();
  const batches = createBatchStore(internal.db);

  await eventing.subscribe('ingest.received', (event) => handleIngestEvent({ blob, persist, converters, batches, logger }, event));

  const internalMigrator = createMigrator(internal.db, internalMigrations);
  const externalMigrator = createMigrator(externalDb, externalMigrations);

  return {
    accept: (input) => acceptPayload({ blob, eventing, batches, logger }, input),
    drain: () => eventing.drain(),
    startWorker: () => eventing.startWorker(),
    batches,
    async republish(batch) {
      await eventing.publish({ type: 'ingest.received', payload: { batchId: batch.batch_id, blobKey: batch.blob_key, source: batch.source ?? 'cli', converter: batch.converter } });
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
