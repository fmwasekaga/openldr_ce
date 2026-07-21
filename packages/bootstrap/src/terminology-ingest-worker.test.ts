import { describe, it, expect, vi } from 'vitest';
import { createTerminologyIngestWorker } from './terminology-ingest-worker';

function job(over: Partial<any> = {}) {
  return { id: 'j1', systemType: 'loinc', codingSystemId: 'cs1', blobKey: 'terminology-dist/loinc/j1.zip', version: '2.82', status: 'running', phase: null, processed: 0, total: null, error: null, createdBy: 'admin1', createdAt: '', startedAt: '', finishedAt: null, ...over };
}

function deps(over: Partial<any> = {}) {
  const state: any = { finished: [], audited: [], deleted: [], progress: [] };
  const j = job();
  return {
    state,
    d: {
      jobs: {
        claimNext: vi.fn().mockResolvedValueOnce(j).mockResolvedValue(null),
        updateProgress: vi.fn(async (_id, p) => { state.progress.push(p); }),
        finish: vi.fn(async (id, s, e) => { state.finished.push({ id, s, e }); }),
        latestForSystem: vi.fn(async () => ({ id: 'j0', blobKey: 'terminology-dist/loinc/j0.zip', status: 'ready' })),
        latestReadyForSystem: vi.fn(async () => ({ id: 'j0', blobKey: 'terminology-dist/loinc/j0.zip', status: 'ready' })),
        get: vi.fn(), enqueue: vi.fn(), hasActive: vi.fn(),
        failStaleRunning: vi.fn(async () => 0),
      },
      blob: { getStream: vi.fn(), delete: vi.fn(async (k: string) => { state.deleted.push(k); }) },
      runIngest: vi.fn(async (_j, onP) => { onP({ phase: 'concepts', processed: 5, total: 5 }); return { conceptsLoaded: 5 }; }),
      audit: { record: vi.fn(async (e: any) => { state.audited.push(e); return { ...e, id: 'a', occurredAt: '' }; }) },
      workDirBase: '/tmp',
      logger: { info() {}, error() {} },
      ...over,
    },
  };
}

describe('terminology ingest worker', () => {
  it('claims a job, ingests, finishes ready, audits completed, deletes the prior blob', async () => {
    const { state, d } = deps();
    const w = createTerminologyIngestWorker(d as never);
    await w.tickOnce();
    expect(d.runIngest).toHaveBeenCalledTimes(1);
    expect(state.finished).toEqual([{ id: 'j1', s: 'ready', e: null }]);
    expect(state.audited[0]).toMatchObject({ action: 'terminology.import.completed', actorType: 'system' });
    expect(state.deleted).toEqual(['terminology-dist/loinc/j0.zip']); // prior retained blob removed
    await w.stop();
  });

  it('on ingest failure: finishes failed, audits failed, keeps the blob', async () => {
    const { state, d } = deps({ runIngest: vi.fn(async () => { throw new Error('boom'); }) });
    const w = createTerminologyIngestWorker(d as never);
    await w.tickOnce();
    expect(state.finished[0]).toMatchObject({ id: 'j1', s: 'failed' });
    expect(state.finished[0].e).toMatch(/boom/);
    expect(state.audited[0]).toMatchObject({ action: 'terminology.import.failed' });
    expect(state.deleted).toEqual([]); // blob retained for retry
    await w.stop();
  });

  it('does nothing when no job is queued', async () => {
    const { d } = deps({ jobs: { claimNext: vi.fn(async () => null), updateProgress: vi.fn(), finish: vi.fn(), latestForSystem: vi.fn(), latestReadyForSystem: vi.fn(), get: vi.fn(), enqueue: vi.fn(), hasActive: vi.fn(), failStaleRunning: vi.fn(async () => 0) } });
    const w = createTerminologyIngestWorker(d as never);
    await w.tickOnce();
    expect(d.runIngest).not.toHaveBeenCalled();
    await w.stop();
  });

  it('fails orphaned running jobs once at startup', async () => {
    const { d } = deps();
    const failStaleRunning = vi.fn(async () => 2);
    const info = vi.fn();
    d.jobs.failStaleRunning = failStaleRunning;
    d.logger = { info, error() {} };
    const w = createTerminologyIngestWorker(d as never);
    await new Promise((r) => setTimeout(r, 0)); // let the fire-and-forget startup promise settle
    expect(failStaleRunning).toHaveBeenCalledWith('interrupted — the server restarted before the import finished');
    expect(info).toHaveBeenCalled();
    await w.stop();
  });

  it('stop() awaits the in-flight startup crash-recovery before resolving', async () => {
    let release!: (n: number) => void;
    const gate = new Promise<number>((r) => { release = r; });
    const { d } = deps();
    const info = vi.fn();
    d.jobs.failStaleRunning = vi.fn(() => gate); // stays pending until we release it
    d.logger = { info, error() {} };
    const w = createTerminologyIngestWorker(d as never);
    let stopResolved = false;
    const stopping = w.stop().then(() => { stopResolved = true; });
    await new Promise((r) => setTimeout(r, 0));
    expect(stopResolved).toBe(false); // stop() must not resolve while crash-recovery is pending
    release(3);
    await stopping;
    expect(stopResolved).toBe(true);
    expect(info).toHaveBeenCalled(); // the .then log ran as part of the awaited chain
  });
});
