import { describe, it, expect, vi } from 'vitest';
import { runIngestJob } from './terminology-ingest-shared';
import type { TerminologyIngestJob } from '@openldr/db';

const job = { id: 'tij_1', systemType: 'snomed', codingSystemId: 'cs_1', blobKey: 'k/new.zip', version: '2026', status: 'running' } as TerminologyIngestJob;
const logger = { info: vi.fn(), error: vi.fn() };

function deps(over: Partial<Parameters<typeof runIngestJob>[0]> = {}) {
  return {
    job,
    jobs: {
      latestReadyForSystem: vi.fn(async () => null),
      updateProgress: vi.fn(async () => {}),
      finish: vi.fn(async () => {}),
    },
    blob: { delete: vi.fn(async () => {}) },
    runIngest: vi.fn(async () => ({ conceptsLoaded: 42 })),
    audit: { record: vi.fn(async () => {}) },
    logger,
    ...over,
  } as Parameters<typeof runIngestJob>[0];
}

describe('runIngestJob', () => {
  it('finishes ready, audits completed, deletes the prior ready blob, returns conceptsLoaded', async () => {
    const d = deps({ jobs: {
      latestReadyForSystem: vi.fn(async () => ({ status: 'ready', blobKey: 'k/old.zip' } as never)),
      updateProgress: vi.fn(async () => {}), finish: vi.fn(async () => {}),
    } });
    const r = await runIngestJob(d);
    expect(r).toEqual({ status: 'ready', conceptsLoaded: 42, error: null });
    expect(d.jobs.finish).toHaveBeenCalledWith('tij_1', 'ready', null);
    expect(d.audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'terminology.import.completed' }));
    expect(d.blob.delete).toHaveBeenCalledWith('k/old.zip');
  });

  it('does NOT delete the prior blob when it equals the current job blob', async () => {
    const d = deps({ jobs: {
      latestReadyForSystem: vi.fn(async () => ({ status: 'ready', blobKey: 'k/new.zip' } as never)),
      updateProgress: vi.fn(async () => {}), finish: vi.fn(async () => {}),
    } });
    await runIngestJob(d);
    expect(d.blob.delete).not.toHaveBeenCalled();
  });

  it('on runIngest throw: finishes failed with a redacted message, audits failed, keeps the blob', async () => {
    const d = deps({ runIngest: vi.fn(async () => { throw new Error('boom'); }) });
    const r = await runIngestJob(d);
    expect(r.status).toBe('failed');
    expect(d.jobs.finish).toHaveBeenCalledWith('tij_1', 'failed', expect.stringContaining('boom'));
    expect(d.audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'terminology.import.failed' }));
    expect(d.blob.delete).not.toHaveBeenCalled();
  });

  it('forwards progress to the optional onProgress AND jobs.updateProgress', async () => {
    const onProgress = vi.fn();
    const d = deps({ onProgress, runIngest: vi.fn(async (_j, cb) => { cb({ phase: 'flat', processed: 5, total: 10 }); return { conceptsLoaded: 1 }; }) });
    await runIngestJob(d);
    expect(onProgress).toHaveBeenCalledWith({ phase: 'flat', processed: 5, total: 10 });
    expect(d.jobs.updateProgress).toHaveBeenCalledWith('tij_1', { phase: 'flat', processed: 5, total: 10 });
  });
});
