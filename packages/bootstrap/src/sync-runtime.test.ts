import { describe, it, expect, vi } from 'vitest';
import { createSyncRuntime } from './sync-runtime';

function fakeWorker() {
  const w = { started: 0, stopped: 0, running: false,
    start() { this.started++; this.running = true; },
    stop() { this.stopped++; this.running = false; },
    trigger() {}, isRunning() { return this.running; } };
  return w;
}

function makeRuntime(overrides: Partial<Parameters<typeof createSyncRuntime>[0]> = {}) {
  const push = fakeWorker(); const pull = fakeWorker();
  const deps = {
    logger: { info() {}, warn() {}, error() {} } as any,
    readConfig: vi.fn(async () => null as any),
    buildPush: vi.fn(async () => ({ worker: push, listenClient: undefined })),
    buildPull: vi.fn(async () => ({ worker: pull })),
    ...overrides,
  };
  return { rt: createSyncRuntime(deps as any), push, pull, deps };
}

describe('SyncRuntime.reconcile', () => {
  it('disabled config → no workers, enabled=false', async () => {
    const { rt } = makeRuntime();
    await rt.reconcile();
    expect(rt.isEnabled()).toBe(false);
    expect(rt.pushWorker()).toBeUndefined();
    expect(rt.pullWorker()).toBeUndefined();
  });

  it('bidirectional → starts BOTH workers; enabled/mode reflect it', async () => {
    const { rt, push, pull } = makeRuntime({
      readConfig: vi.fn(async () => ({ mode: 'bidirectional', intervalMinutes: 1, centralUrl: 'u', siteId: 's' } as any)),
    });
    await rt.reconcile();
    expect(rt.isEnabled()).toBe(true);
    expect(rt.mode()).toBe('bidirectional');
    expect(push.started).toBe(1);
    expect(pull.started).toBe(1);
  });

  it('push mode → only push worker', async () => {
    const { rt, push, pull } = makeRuntime({
      readConfig: vi.fn(async () => ({ mode: 'push', intervalMinutes: 1, centralUrl: 'u', siteId: 's' } as any)),
    });
    await rt.reconcile();
    expect(push.started).toBe(1);
    expect(pull.started).toBe(0);
    expect(rt.pullWorker()).toBeUndefined();
  });

  it('enabled → disabled STOPS the running workers', async () => {
    let cfg: any = { mode: 'bidirectional', intervalMinutes: 1, centralUrl: 'u', siteId: 's' };
    const { rt, push, pull } = makeRuntime({ readConfig: vi.fn(async () => cfg) });
    await rt.reconcile();
    cfg = null;
    await rt.reconcile();
    expect(push.stopped).toBe(1);
    expect(pull.stopped).toBe(1);
    expect(rt.isEnabled()).toBe(false);
  });

  it('reconcile REBUILDS: a second enabled reconcile stops the old worker before starting a new one', async () => {
    const workers: ReturnType<typeof fakeWorker>[] = [];
    const buildPush = vi.fn(async () => { const w = fakeWorker(); workers.push(w); return { worker: w, listenClient: undefined }; });
    const { rt } = makeRuntime({
      readConfig: vi.fn(async () => ({ mode: 'push', intervalMinutes: 1, centralUrl: 'u', siteId: 's' } as any)),
      buildPush,
    });
    await rt.reconcile();
    await rt.reconcile();
    expect(workers).toHaveLength(2);
    expect(workers[0]!.stopped).toBe(1);
    expect(workers[1]!.started).toBe(1);
  });

  it('a build failure rolls back: stops the push worker, enabled=false, rethrows', async () => {
    const push = fakeWorker();
    const { rt } = makeRuntime({
      readConfig: vi.fn(async () => ({ mode: 'bidirectional', intervalMinutes: 1, centralUrl: 'u', siteId: 's' } as any)),
      buildPush: vi.fn(async () => ({ worker: push, listenClient: undefined })),
      buildPull: vi.fn(async () => { throw new Error('pull build boom'); }),
    });
    await expect(rt.reconcile()).rejects.toThrow('pull build boom');
    expect(push.started).toBe(1);
    expect(push.stopped).toBe(1);        // rolled back
    expect(rt.isEnabled()).toBe(false);  // not left half-enabled
    expect(rt.pushWorker()).toBeUndefined();
    expect(rt.pullWorker()).toBeUndefined();
  });

  it('disabling resets mode/centralUrl/siteId to defaults (no stale values)', async () => {
    let cfg: any = { mode: 'push', intervalMinutes: 1, centralUrl: 'https://c', siteId: 'lab-1' };
    const { rt } = makeRuntime({ readConfig: vi.fn(async () => cfg) });
    await rt.reconcile();
    expect(rt.centralUrl()).toBe('https://c');
    cfg = null;
    await rt.reconcile();
    expect(rt.isEnabled()).toBe(false);
    expect(rt.mode()).toBe('bidirectional');
    expect(rt.centralUrl()).toBe('');
    expect(rt.siteId()).toBe('');
  });

  it('concurrent reconciles serialize (no overlap)', async () => {
    let active = 0; let maxActive = 0;
    const readConfig = vi.fn(async () => { active++; maxActive = Math.max(maxActive, active); await Promise.resolve(); active--; return null as any; });
    const { rt } = makeRuntime({ readConfig });
    await Promise.all([rt.reconcile(), rt.reconcile(), rt.reconcile()]);
    expect(maxActive).toBe(1);
  });
});
