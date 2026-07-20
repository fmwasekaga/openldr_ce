import { describe, it, expect } from 'vitest';
import { makeMigratedDb } from './migrations/internal/test-helpers';
import { createTerminologyIngestJobStore } from './terminology-ingest-job-store';

describe('terminology ingest job store', () => {
  it('enqueues a queued job and reads it back', async () => {
    const db = await makeMigratedDb();
    const store = createTerminologyIngestJobStore(db as never);
    const job = await store.enqueue({ systemType: 'loinc', codingSystemId: 'cs1', blobKey: 'terminology-dist/loinc/j1.zip', version: '2.82', createdBy: 'admin1' });
    expect(job.status).toBe('queued');
    expect(job.systemType).toBe('loinc');
    const got = await store.get(job.id);
    expect(got?.blobKey).toBe('terminology-dist/loinc/j1.zip');
    await db.destroy();
  });

  it('rejects a second active job for the same system', async () => {
    const db = await makeMigratedDb();
    const store = createTerminologyIngestJobStore(db as never);
    await store.enqueue({ systemType: 'loinc', codingSystemId: 'cs1', blobKey: 'a.zip', version: null, createdBy: null });
    expect(await store.hasActive('loinc')).toBe(true);
    await expect(store.enqueue({ systemType: 'loinc', codingSystemId: 'cs1', blobKey: 'b.zip', version: null, createdBy: null })).rejects.toThrow();
    await db.destroy();
  });

  it('claimNext moves the oldest queued job to running exactly once', async () => {
    const db = await makeMigratedDb();
    const store = createTerminologyIngestJobStore(db as never);
    const a = await store.enqueue({ systemType: 'loinc', codingSystemId: 'cs1', blobKey: 'a.zip', version: null, createdBy: null });
    const claimed = await store.claimNext();
    expect(claimed?.id).toBe(a.id);
    expect(claimed?.status).toBe('running');
    expect(await store.claimNext()).toBeNull(); // nothing else queued
    await db.destroy();
  });

  it('updateProgress + finish transition status', async () => {
    const db = await makeMigratedDb();
    const store = createTerminologyIngestJobStore(db as never);
    const a = await store.enqueue({ systemType: 'loinc', codingSystemId: 'cs1', blobKey: 'a.zip', version: null, createdBy: null });
    await store.claimNext();
    await store.updateProgress(a.id, { phase: 'concepts', processed: 500, total: 1000 });
    await store.finish(a.id, 'ready', null);
    const got = await store.get(a.id);
    expect(got?.status).toBe('ready');
    expect(got?.processed).toBe(500);
    expect(await store.latestForSystem('loinc')).toMatchObject({ id: a.id, status: 'ready' });
    await db.destroy();
  });
});
