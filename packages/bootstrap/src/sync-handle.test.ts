import { describe, it, expect, vi } from 'vitest';
import { makeMigratedDb } from '@openldr/db/testing';
import { createSyncQuarantineStore } from '@openldr/db';
import { createSyncHandle } from './sync-handle';

type Db = Awaited<ReturnType<typeof makeMigratedDb>>;

const PUSH_DATE = new Date('2026-07-14T08:30:00.000Z');

async function seed(db: Db) {
  // Separate inserts: pg-mem rejects a multi-row insert that mixes an explicit value with a
  // column default (sync-pull's updated_at defaults to now()).
  await db.insertInto('fhir.change_cursors').values({ consumer: 'sync-push', last_seq: 142, updated_at: PUSH_DATE }).execute();
  await db.insertInto('fhir.change_cursors').values({ consumer: 'sync-pull', last_seq: 88 }).execute();
  // change_log rows up to seq 150 (default-generated seq is sequential in insert order).
  await db
    .insertInto('fhir.change_log')
    .values(
      Array.from({ length: 150 }, (_, i) => ({
        resource_type: 'Patient',
        resource_id: `p${i}`,
        version: 1,
        op: 'upsert',
        content_hash: null,
        site_id: null,
      })),
    )
    .execute();
}

const runningWorker = () => ({ isRunning: () => true, trigger: vi.fn() });
const stoppedWorker = () => ({ isRunning: () => false, trigger: vi.fn() });

describe('createSyncHandle.status', () => {
  it('reports both directions, cursors, running state, and pendingPush', async () => {
    const db = await makeMigratedDb();
    await seed(db);
    const handle = createSyncHandle({
      db,
      enabled: true,
      mode: 'bidirectional',
      centralUrl: 'https://central.example',
      siteId: 'lab-7',
      pushWorker: runningWorker(),
      pullWorker: runningWorker(),
    });

    const s = await handle.status();
    expect(s.enabled).toBe(true);
    expect(s.mode).toBe('bidirectional');
    expect(s.centralUrl).toBe('https://central.example');
    expect(s.siteId).toBe('lab-7');
    expect(s.push).toEqual({ running: true, lastSeq: 142, lastSyncedAt: PUSH_DATE.toISOString() });
    expect(s.pull?.running).toBe(true);
    expect(s.pull?.lastSeq).toBe(88);
    expect(typeof s.pull?.lastSyncedAt).toBe('string'); // updated_at defaults to now() on insert
    expect(s.pendingPush).toBe(8); // 150 - 142
  });

  it('reports disabled state with null directions and no head query', async () => {
    const db = await makeMigratedDb();
    await seed(db);
    const handle = createSyncHandle({
      db,
      enabled: false,
      mode: 'bidirectional',
      centralUrl: '',
      siteId: '',
    });

    const s = await handle.status();
    expect(s.enabled).toBe(false);
    expect(s.push).toBeNull();
    expect(s.pull).toBeNull();
    expect(s.pendingPush).toBe(0);
  });

  it('push-only: pull is null, push present', async () => {
    const db = await makeMigratedDb();
    await seed(db);
    const handle = createSyncHandle({
      db,
      enabled: true,
      mode: 'push',
      centralUrl: 'https://c',
      siteId: 's',
      pushWorker: runningWorker(),
    });

    const s = await handle.status();
    expect(s.pull).toBeNull();
    expect(s.push).toEqual({ running: true, lastSeq: 142, lastSyncedAt: PUSH_DATE.toISOString() });
    expect(s.pendingPush).toBe(8);
  });

  it('a stopped worker reports running:false', async () => {
    const db = await makeMigratedDb();
    await seed(db);
    const handle = createSyncHandle({
      db,
      enabled: true,
      mode: 'push',
      centralUrl: 'https://c',
      siteId: 's',
      pushWorker: stoppedWorker(),
    });

    const s = await handle.status();
    expect(s.push?.running).toBe(false);
  });

  it('lastSyncedAt is null when the direction has no cursor row', async () => {
    const db = await makeMigratedDb(); // no seed → empty cursors + empty change_log
    const handle = createSyncHandle({
      db,
      enabled: true,
      mode: 'push',
      centralUrl: 'https://c',
      siteId: 's',
      pushWorker: runningWorker(),
    });

    const s = await handle.status();
    expect(s.push).toEqual({ running: true, lastSeq: 0, lastSyncedAt: null });
    expect(s.pendingPush).toBe(0); // empty change_log
  });
});

describe('createSyncHandle.triggerNow', () => {
  it('triggers both workers when both are present', async () => {
    const db = await makeMigratedDb();
    const push = runningWorker();
    const pull = runningWorker();
    const handle = createSyncHandle({
      db,
      enabled: true,
      mode: 'bidirectional',
      centralUrl: '',
      siteId: '',
      pushWorker: push,
      pullWorker: pull,
    });

    handle.triggerNow();
    expect(push.trigger).toHaveBeenCalledTimes(1);
    expect(pull.trigger).toHaveBeenCalledTimes(1);
  });

  it('triggers only the push worker when it is the only one present', async () => {
    const db = await makeMigratedDb();
    const push = runningWorker();
    const handle = createSyncHandle({
      db,
      enabled: true,
      mode: 'push',
      centralUrl: '',
      siteId: '',
      pushWorker: push,
    });

    handle.triggerNow();
    expect(push.trigger).toHaveBeenCalledTimes(1);
  });

  it('is a no-op when no workers are present (disabled)', async () => {
    const db = await makeMigratedDb();
    const handle = createSyncHandle({
      db,
      enabled: false,
      mode: 'bidirectional',
      centralUrl: '',
      siteId: '',
    });

    expect(() => handle.triggerNow()).not.toThrow();
  });
});

describe('createSyncHandle quarantine', () => {
  it('listQuarantine returns [] when no store; delegates when present', async () => {
    const db = await makeMigratedDb();
    const rows = [{ entityType: 'terminology_system', entityId: 'http://x', attempts: 3, status: 'quarantined' }] as any;
    const base = { enabled: true, mode: 'pull' as const, centralUrl: '', siteId: '' };
    const h1 = createSyncHandle({ db, ...base });
    expect(await h1.listQuarantine()).toEqual([]);
    const h2 = createSyncHandle({ db, ...base, quarantine: { list: async () => rows } as any });
    expect(await h2.listQuarantine()).toEqual(rows);
  });

  it('listQuarantine reads durable rows on a sync-DISABLED / push-only node (no pull worker)', async () => {
    // Regression: the store used to be built only inside the pull gate, so a push-only or sync-disabled
    // node reported [] even though durable rows from earlier boots were sitting in the table — hiding
    // them exactly where an operator goes looking. Listing only reads the table; it is never gated.
    const db = await makeMigratedDb();
    const store = createSyncQuarantineStore(db);
    await store.recordFailure('terminology_system', 'http://x', { seq: 9, error: 'boom', threshold: 3 });

    const handle = createSyncHandle({
      db,
      enabled: false, // sync off this boot
      mode: 'push',
      centralUrl: '',
      siteId: '',
      quarantine: store, // ...but the store is still wired
    });
    const rows = await handle.listQuarantine();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.entityId).toBe('http://x');
    // Retry, by contrast, legitimately needs the pull-side bulk sync and stays unavailable here.
    expect(await handle.retryQuarantine('terminology_system', 'http://x')).toEqual({
      ok: false,
      error: expect.stringContaining('not enabled'),
    });
  });

  it('retryQuarantine errors when pull not enabled; delegates when wired', async () => {
    const db = await makeMigratedDb();
    const base = { enabled: true, mode: 'pull' as const, centralUrl: '', siteId: '' };
    const h1 = createSyncHandle({ db, ...base });
    expect(await h1.retryQuarantine('terminology_system', 'http://x')).toEqual({
      ok: false,
      error: expect.stringContaining('not enabled'),
    });
    const retry = vi.fn(async () => ({ ok: true }));
    const h2 = createSyncHandle({ db, ...base, retryQuarantine: retry });
    expect(await h2.retryQuarantine('terminology_system', 'http://x')).toEqual({ ok: true });
    expect(retry).toHaveBeenCalledWith('terminology_system', 'http://x');
  });
});
