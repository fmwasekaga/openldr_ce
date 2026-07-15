import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockCtx = vi.hoisted(() => ({
  sync: {
    listDivergences: vi.fn(),
    getDivergence: vi.fn(),
    clearDivergence: vi.fn(),
  },
  close: vi.fn(),
}));
const createAppContext = vi.hoisted(() => vi.fn(async () => mockCtx));

vi.mock('@openldr/config', () => ({ loadConfig: vi.fn(() => ({ config: true })) }));
vi.mock('@openldr/bootstrap', () => ({ createAppContext }));

import { runSyncDivergenceList, runSyncDivergenceShow, runSyncDivergenceClear } from './sync';

const ROW = {
  resourceType: 'Observation',
  resourceId: 'o1',
  version: 2,
  localHash: 'aaa',
  incomingHash: 'bbb',
  incomingSiteId: 'lab-a',
  detectedAt: new Date('2026-07-15T00:00:00Z'),
};

describe('sync divergence CLI', () => {
  let out: ReturnType<typeof vi.fn>;
  let err: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true) as unknown as ReturnType<typeof vi.fn>;
    err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true) as unknown as ReturnType<typeof vi.fn>;
  });
  afterEach(() => {
    out.mockRestore();
    err.mockRestore();
  });

  const stdout = (): string => out.mock.calls.map((c) => c[0]).join('');
  const stderr = (): string => err.mock.calls.map((c) => c[0]).join('');

  it('list prints a friendly line per row and exits 0', async () => {
    mockCtx.sync.listDivergences.mockResolvedValueOnce([ROW]);
    await expect(runSyncDivergenceList({ json: false })).resolves.toBe(0);
    const text = stdout();
    expect(text).toContain('Observation');
    expect(text).toContain('o1');
    expect(mockCtx.close).toHaveBeenCalledTimes(1);
  });

  it('list says so when there are none', async () => {
    mockCtx.sync.listDivergences.mockResolvedValueOnce([]);
    await expect(runSyncDivergenceList({ json: false })).resolves.toBe(0);
    expect(stdout()).toContain('no divergences');
  });

  it('show exits 1 for an unknown divergence', async () => {
    mockCtx.sync.getDivergence.mockResolvedValueOnce(undefined);
    await expect(runSyncDivergenceShow('Observation', 'o1', 2, { json: false })).resolves.toBe(1);
    expect(mockCtx.sync.getDivergence).toHaveBeenCalledWith('Observation', 'o1', 2);
    expect(mockCtx.close).toHaveBeenCalledTimes(1);
  });

  it('show emits the row including the dropped body', async () => {
    mockCtx.sync.getDivergence.mockResolvedValueOnce({ ...ROW, incomingBody: { status: 'amended' } });
    await expect(runSyncDivergenceShow('Observation', 'o1', 2, { json: false })).resolves.toBe(0);
    expect(stdout()).toContain('amended');
  });

  it('clear exits 0 and calls through', async () => {
    mockCtx.sync.getDivergence.mockResolvedValueOnce(ROW);
    await expect(runSyncDivergenceClear('Observation', 'o1', 2, { json: false })).resolves.toBe(0);
    expect(mockCtx.sync.clearDivergence).toHaveBeenCalledWith('Observation', 'o1', 2);
  });

  it('clear exits 1 when the divergence does not exist', async () => {
    mockCtx.sync.getDivergence.mockResolvedValueOnce(undefined);
    await expect(runSyncDivergenceClear('Observation', 'o1', 2, { json: false })).resolves.toBe(1);
    expect(mockCtx.sync.clearDivergence).not.toHaveBeenCalled();
  });

  it('rejects a non-numeric version without touching the context', async () => {
    await expect(runSyncDivergenceShow('Observation', 'o1', Number('abc'), { json: false })).resolves.toBe(1);
    expect(createAppContext).not.toHaveBeenCalled();
    expect(stderr()).toContain('version must be a positive integer');
  });

  it('clear rejects a non-numeric version without touching the context', async () => {
    await expect(runSyncDivergenceClear('Observation', 'o1', Number('abc'), { json: false })).resolves.toBe(1);
    expect(createAppContext).not.toHaveBeenCalled();
    expect(mockCtx.sync.clearDivergence).not.toHaveBeenCalled();
    expect(stderr()).toContain('version must be a positive integer');
  });

  // A bad version arg must honour --json like every other validation error in sync.ts: the {error}
  // envelope on stdout, not raw text on stderr — scripts parsing --json output contract for it.
  it('emits the JSON error envelope for a bad version with --json', async () => {
    for (const run of [runSyncDivergenceShow, runSyncDivergenceClear]) {
      out.mockClear();
      err.mockClear();
      await expect(run('Observation', 'o1', Number('abc'), { json: true })).resolves.toBe(1);
      expect(stdout()).toBe(JSON.stringify({ error: 'version must be a positive integer' }, null, 2) + '\n');
      expect(stderr()).toBe('');
      expect(createAppContext).not.toHaveBeenCalled();
    }
  });
});
