import { randomUUID } from 'node:crypto';
import { type Kysely, sql } from 'kysely';
import type { InternalSchema } from './schema/internal';

export type IngestJobStatus = 'queued' | 'running' | 'ready' | 'failed';

export interface TerminologyIngestJob {
  id: string;
  systemType: string;
  codingSystemId: string;
  blobKey: string;
  version: string | null;
  status: IngestJobStatus;
  phase: string | null;
  processed: number;
  total: number | null;
  error: string | null;
  createdBy: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface TerminologyIngestJobStore {
  enqueue(input: { systemType: string; codingSystemId: string; blobKey: string; version: string | null; createdBy: string | null }): Promise<TerminologyIngestJob>;
  insertRunning(input: { systemType: string; codingSystemId: string; blobKey: string; version: string | null; createdBy: string | null }): Promise<TerminologyIngestJob>;
  claimNext(): Promise<TerminologyIngestJob | null>;
  updateProgress(id: string, p: { phase: string; processed: number; total: number | null }): Promise<void>;
  finish(id: string, status: 'ready' | 'failed', error: string | null): Promise<void>;
  get(id: string): Promise<TerminologyIngestJob | null>;
  latestForSystem(systemType: string): Promise<TerminologyIngestJob | null>;
  latestReadyForSystem(systemType: string): Promise<TerminologyIngestJob | null>;
  hasActive(systemType: string): Promise<boolean>;
  failStaleRunning(error: string): Promise<number>;
}

type Row = {
  id: string; system_type: string; coding_system_id: string; blob_key: string; version: string | null;
  status: string; phase: string | null; processed: string | number; total: string | number | null; error: string | null;
  created_by: string | null; created_at: Date; started_at: Date | null; finished_at: Date | null;
};

function toJob(r: Row): TerminologyIngestJob {
  return {
    id: r.id, systemType: r.system_type, codingSystemId: r.coding_system_id, blobKey: r.blob_key, version: r.version,
    status: r.status as IngestJobStatus, phase: r.phase, processed: Number(r.processed), total: r.total == null ? null : Number(r.total),
    error: r.error, createdBy: r.created_by,
    createdAt: new Date(r.created_at).toISOString(),
    startedAt: r.started_at ? new Date(r.started_at).toISOString() : null,
    finishedAt: r.finished_at ? new Date(r.finished_at).toISOString() : null,
  };
}

export function createTerminologyIngestJobStore(db: Kysely<InternalSchema>): TerminologyIngestJobStore {
  const store: TerminologyIngestJobStore = {
    async enqueue(input) {
      // Explicit pre-check so a second active enqueue fails deterministically (and with a
      // readable message) both here and under concurrent access, where the unique index on
      // `active_key` (see 061 migration) is the race-safe backstop in real Postgres.
      if (await store.hasActive(input.systemType)) {
        throw new Error(`A terminology ingest job is already active for system "${input.systemType}"`);
      }
      const id = `tij_${randomUUID().slice(0, 8)}`;
      await db.insertInto('terminology_ingest_jobs')
        .values({
          id, system_type: input.systemType, coding_system_id: input.codingSystemId, blob_key: input.blobKey,
          version: input.version, status: 'queued', created_by: input.createdBy,
          // Marks this row "active" for the one-active-job-per-system unique index (see 061 migration).
          active_key: input.systemType,
        } as never)
        .execute();
      const row = await db.selectFrom('terminology_ingest_jobs').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
      return toJob(row as never);
    },
    async insertRunning(input) {
      // Insert a job already claimed by this process (status 'running'), so a live server worker —
      // which only claims 'queued' — never races an inline CLI ingest. The one-active-per-system
      // guard (hasActive + the active_key unique index) still rejects a concurrent second import.
      if (await store.hasActive(input.systemType)) {
        throw new Error(`A terminology ingest job is already active for system "${input.systemType}"`);
      }
      const id = `tij_${randomUUID().slice(0, 8)}`;
      await db.insertInto('terminology_ingest_jobs')
        .values({
          id, system_type: input.systemType, coding_system_id: input.codingSystemId, blob_key: input.blobKey,
          version: input.version, status: 'running', started_at: sql`now()` as never, created_by: input.createdBy,
          active_key: input.systemType,
        } as never)
        .execute();
      const row = await db.selectFrom('terminology_ingest_jobs').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
      return toJob(row as never);
    },
    async claimNext() {
      // pg-mem does not support `FOR UPDATE SKIP LOCKED` inside a correlated subquery, so we
      // adapt: select the oldest queued id, then a guarded `UPDATE ... WHERE id = ? AND
      // status = 'queued' RETURNING *`. The WHERE-status guard keeps this race-safe under real
      // concurrent claimers in Postgres too (a second claimer racing on the same id simply
      // updates 0 rows instead of double-claiming).
      const next = await db.selectFrom('terminology_ingest_jobs').select('id')
        .where('status', '=', 'queued').orderBy('created_at', 'asc').limit(1).executeTakeFirst();
      if (!next) return null;
      const rows = await sql<Row>`
        update terminology_ingest_jobs
        set status = 'running', started_at = now()
        where id = ${next.id} and status = 'queued'
        returning *
      `.execute(db);
      const r = rows.rows[0];
      return r ? toJob(r) : null;
    },
    async updateProgress(id, p) {
      await db.updateTable('terminology_ingest_jobs')
        .set({ phase: p.phase, processed: p.processed as never, total: (p.total ?? null) as never })
        .where('id', '=', id)
        .execute();
    },
    async finish(id, status, error) {
      await db.updateTable('terminology_ingest_jobs')
        // Clear active_key so the row no longer occupies the one-active-job-per-system slot.
        .set({ status, error, finished_at: sql`now()` as never, active_key: null })
        .where('id', '=', id)
        .execute();
    },
    async get(id) {
      const r = await db.selectFrom('terminology_ingest_jobs').selectAll().where('id', '=', id).executeTakeFirst();
      return r ? toJob(r as never) : null;
    },
    async latestForSystem(systemType) {
      const r = await db.selectFrom('terminology_ingest_jobs').selectAll()
        .where('system_type', '=', systemType).orderBy('created_at', 'desc').limit(1).executeTakeFirst();
      return r ? toJob(r as never) : null;
    },
    async latestReadyForSystem(systemType) {
      const r = await db.selectFrom('terminology_ingest_jobs').selectAll()
        .where('system_type', '=', systemType).where('status', '=', 'ready')
        .orderBy('created_at', 'desc').limit(1).executeTakeFirst();
      return r ? toJob(r as never) : null;
    },
    async hasActive(systemType) {
      const r = await db.selectFrom('terminology_ingest_jobs').select('id')
        .where('system_type', '=', systemType).where('status', 'in', ['queued', 'running']).executeTakeFirst();
      return !!r;
    },
    async failStaleRunning(error) {
      // Crash recovery: on a single-worker install any job left 'running' is orphaned. Fail it and
      // clear active_key so its one-active slot frees up. Returns how many were reset.
      const rows = await sql<{ id: string }>`
        update terminology_ingest_jobs
        set status = 'failed', error = ${error}, finished_at = now(), active_key = null
        where status = 'running'
        returning id
      `.execute(db);
      return rows.rows.length;
    },
  };
  return store;
}
