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

  it('latestReadyForSystem returns the newest ready job, not a later running job', async () => {
    const db = await makeMigratedDb();
    const store = createTerminologyIngestJobStore(db as never);
    // First job: enqueue, claim, and finish to 'ready'.
    const first = await store.enqueue({ systemType: 'loinc', codingSystemId: 'cs1', blobKey: 'terminology-dist/loinc/j1.zip', version: '2.82', createdBy: null });
    await store.claimNext();
    await store.finish(first.id, 'ready', null);
    // Second job for the same system: enqueue (queued) — the one-active-per-system rule allows
    // this now that the first job is no longer active.
    const second = await store.enqueue({ systemType: 'loinc', codingSystemId: 'cs1', blobKey: 'terminology-dist/loinc/j2.zip', version: '2.83', createdBy: null });
    await store.claimNext(); // moves `second` to 'running'
    const ready = await store.latestReadyForSystem('loinc');
    expect(ready?.id).toBe(first.id);
    expect(ready?.status).toBe('ready');
    expect(ready?.id).not.toBe(second.id);
    await db.destroy();
  });

  it('insertRunning creates a running, active job the queued-only claimer will not pick up', async () => {
    const db = await makeMigratedDb();
    const store = createTerminologyIngestJobStore(db as never);
    const job = await store.insertRunning({ systemType: 'snomed', codingSystemId: 'cs_1', blobKey: 'k/a.zip', version: null, createdBy: 'cli' });
    expect(job.status).toBe('running');
    expect(await store.claimNext()).toBeNull(); // claimNext only claims 'queued'
    expect(await store.hasActive('snomed')).toBe(true);
    await db.destroy();
  });

  it('insertRunning rejects a second active job for the same system', async () => {
    const db = await makeMigratedDb();
    const store = createTerminologyIngestJobStore(db as never);
    await store.insertRunning({ systemType: 'snomed', codingSystemId: 'cs_1', blobKey: 'k/a.zip', version: null, createdBy: 'cli' });
    await expect(store.insertRunning({ systemType: 'snomed', codingSystemId: 'cs_1', blobKey: 'k/b.zip', version: null, createdBy: 'cli' }))
      .rejects.toThrow(/already active/);
    await db.destroy();
  });

  it('failStaleRunning fails only running jobs, clears active_key, and returns the count', async () => {
    const db = await makeMigratedDb();
    const store = createTerminologyIngestJobStore(db as never);
    const running = await store.insertRunning({ systemType: 'snomed', codingSystemId: 'cs_1', blobKey: 'k/a.zip', version: null, createdBy: 'cli' });
    const n = await store.failStaleRunning('interrupted');
    expect(n).toBe(1);
    const after = await store.get(running.id);
    expect(after?.status).toBe('failed');
    expect(after?.error).toBe('interrupted');
    // active_key cleared → a fresh job for the system may now be inserted
    await expect(store.insertRunning({ systemType: 'snomed', codingSystemId: 'cs_1', blobKey: 'k/c.zip', version: null, createdBy: 'cli' })).resolves.toBeDefined();
    await db.destroy();
  });

  it('failStaleRunning leaves queued jobs untouched and returns 0', async () => {
    const db = await makeMigratedDb();
    const store = createTerminologyIngestJobStore(db as never);
    const q = await store.enqueue({ systemType: 'loinc', codingSystemId: 'cs_2', blobKey: 'k/q.zip', version: null, createdBy: null });
    const n = await store.failStaleRunning('interrupted');
    expect(n).toBe(0);
    expect((await store.get(q.id))?.status).toBe('queued');
    await db.destroy();
  });
});
