import { type Kysely, sql } from 'kysely';
import type { InternalSchema } from '@openldr/db';

export interface IngestBatch {
  batch_id: string;
  source: string | null;
  blob_key: string;
  content_type: string | null;
  converter: string;
  status: string;
  resource_count: number;
  attempts: number;
  last_error: string | null;
}

export interface BatchStore {
  create(b: { batchId: string; source: string; blobKey: string; contentType?: string; converter: string; config?: Record<string, string> }): Promise<void>;
  markProcessing(batchId: string): Promise<void>;
  markDone(batchId: string, resourceCount: number): Promise<void>;
  markFailed(batchId: string, error: string): Promise<void>;
  reset(batchId: string): Promise<void>;
  get(batchId: string): Promise<IngestBatch | undefined>;
  list(): Promise<IngestBatch[]>;
  provenanceGaps(): Promise<{ resource_type: string; id: string }[]>;
}

const COLUMNS = ['batch_id', 'source', 'blob_key', 'content_type', 'converter', 'status', 'resource_count', 'attempts', 'last_error'] as const;

export function createBatchStore(db: Kysely<InternalSchema>): BatchStore {
  return {
    async create(b) {
      await db
        .insertInto('ingest_batches')
        .values({ batch_id: b.batchId, source: b.source, blob_key: b.blobKey, content_type: b.contentType ?? null, converter: b.converter, status: 'received' })
        .execute();
    },
    async markProcessing(batchId) {
      await db
        .updateTable('ingest_batches')
        .set({ status: 'processing', attempts: sql`attempts + 1`, updated_at: sql`now()` })
        .where('batch_id', '=', batchId)
        .execute();
    },
    async markDone(batchId, resourceCount) {
      await db
        .updateTable('ingest_batches')
        .set({ status: 'done', resource_count: resourceCount, last_error: null, updated_at: sql`now()` })
        .where('batch_id', '=', batchId)
        .execute();
    },
    async markFailed(batchId, error) {
      await db
        .updateTable('ingest_batches')
        .set({ status: 'failed', last_error: error, updated_at: sql`now()` })
        .where('batch_id', '=', batchId)
        .execute();
    },
    async reset(batchId) {
      await db
        .updateTable('ingest_batches')
        .set({ status: 'received', last_error: null, updated_at: sql`now()` })
        .where('batch_id', '=', batchId)
        .execute();
    },
    async get(batchId) {
      return db.selectFrom('ingest_batches').select(COLUMNS).where('batch_id', '=', batchId).executeTakeFirst();
    },
    async list() {
      return db.selectFrom('ingest_batches').select(COLUMNS).orderBy('created_at', 'desc').limit(100).execute();
    },
    async provenanceGaps() {
      return db
        .selectFrom('fhir_resources')
        .select(['resource_type', 'id'])
        .where((eb) => eb.or([eb('source_system', 'is', null), eb('plugin_id', 'is', null), eb('batch_id', 'is', null)]))
        .limit(500)
        .execute();
    },
  };
}
