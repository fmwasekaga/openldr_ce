import { describe, it, expect, vi } from 'vitest';

const merge = vi.hoisted(() => vi.fn(async () => ({ survivorId: 'p-surv', duplicateId: 'p-dup', repointed: 2, provenanceId: 'prov-1', siteId: 'lab-a' })));
const close = vi.hoisted(() => vi.fn(async () => {}));

vi.mock('@openldr/bootstrap', () => ({ createAppContext: async () => ({ close }), mergePatients: merge }));
vi.mock('@openldr/config', () => ({ loadConfig: () => ({}) }));

import { runSyncMergePatient } from './sync';

describe('runSyncMergePatient', () => {
  it('calls mergePatients and returns 0', async () => {
    const code = await runSyncMergePatient({ survivor: 'p-surv', duplicate: 'p-dup', reason: 'same', json: true });
    expect(code).toBe(0);
    expect(merge).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ survivorId: 'p-surv', duplicateId: 'p-dup' }));
  });

  it('returns 1 on missing options', async () => {
    expect(await runSyncMergePatient({ survivor: '', duplicate: '', json: true })).toBe(1);
  });

  it('maps CrossSiteMergeError to a friendly exit 1', async () => {
    merge.mockRejectedValueOnce(Object.assign(new Error('x'), { name: 'CrossSiteMergeError' }));
    expect(await runSyncMergePatient({ survivor: 'a', duplicate: 'b', json: true })).toBe(1);
  });
});
