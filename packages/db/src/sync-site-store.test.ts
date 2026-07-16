import { describe, it, expect, beforeEach } from 'vitest';
import { makeMigratedDb } from './migrations/internal/test-helpers';
import { createSyncSiteStore } from './sync-site-store';

describe('createSyncSiteStore', () => {
  let db: Awaited<ReturnType<typeof makeMigratedDb>>;
  beforeEach(async () => { db = await makeMigratedDb(); });

  it('inserts then round-trips via get + list (camel<->snake, defaults, ISO timestamp)', async () => {
    const store = createSyncSiteStore(db);
    await store.insert({ siteId: 'lab-a', name: 'Lab A', clientId: 'sync-lab-a', enrolledBy: 'admin' });

    const got = await store.get('lab-a');
    expect(got).toBeDefined();
    expect(got!.siteId).toBe('lab-a');
    expect(got!.name).toBe('Lab A');
    expect(got!.clientId).toBe('sync-lab-a');
    expect(got!.enrolledBy).toBe('admin');
    expect(got!.status).toBe('active'); // column default
    // enrolledAt is a parseable ISO string
    expect(typeof got!.enrolledAt).toBe('string');
    expect(new Date(got!.enrolledAt).toISOString()).toBe(got!.enrolledAt);

    const list = await store.list();
    expect(list).toHaveLength(1);
    expect(list[0].siteId).toBe('lab-a');
  });

  it('accepts null name / enrolledBy', async () => {
    const store = createSyncSiteStore(db);
    await store.insert({ siteId: 'lab-b', name: null, clientId: 'sync-lab-b', enrolledBy: null });
    const got = await store.get('lab-b');
    expect(got!.name).toBeNull();
    expect(got!.enrolledBy).toBeNull();
  });

  it('setStatus revokes a site', async () => {
    const store = createSyncSiteStore(db);
    await store.insert({ siteId: 'lab-c', name: 'Lab C', clientId: 'sync-lab-c', enrolledBy: null });
    await store.setStatus('lab-c', 'revoked');
    expect((await store.get('lab-c'))!.status).toBe('revoked');
  });

  it('setSigningPublicKey round-trips (null until set)', async () => {
    const store = createSyncSiteStore(db);
    await store.insert({ siteId: 'lab-k', name: null, clientId: 'sync-lab-k', enrolledBy: null });
    expect((await store.get('lab-k'))!.signingPublicKey).toBeNull(); // no key exchanged yet

    await store.setSigningPublicKey('lab-k', 'deadbeef');
    expect((await store.get('lab-k'))!.signingPublicKey).toBe('deadbeef');
  });

  it('get returns undefined for an unknown site', async () => {
    const store = createSyncSiteStore(db);
    expect(await store.get('nope')).toBeUndefined();
  });

  it('list orders by enrolled_at desc (newest first)', async () => {
    const store = createSyncSiteStore(db);
    // Insert with explicit ascending enrolled_at so ordering is deterministic under pg-mem.
    await db.insertInto('sync_sites').values({ site_id: 's1', client_id: 'c1', enrolled_at: new Date('2026-01-01T00:00:00Z') } as never).execute();
    await db.insertInto('sync_sites').values({ site_id: 's2', client_id: 'c2', enrolled_at: new Date('2026-02-01T00:00:00Z') } as never).execute();
    await db.insertInto('sync_sites').values({ site_id: 's3', client_id: 'c3', enrolled_at: new Date('2026-03-01T00:00:00Z') } as never).execute();
    const list = await store.list();
    expect(list.map((r) => r.siteId)).toEqual(['s3', 's2', 's1']);
  });
});
