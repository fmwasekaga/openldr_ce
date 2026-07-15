import { describe, expect, it } from 'vitest';
import type { Kysely } from 'kysely';
import { makeMigratedDb } from './migrations/internal/test-helpers';
import { createFhirStore, type RemoteRecord } from './fhir-store';
import { createSyncDivergenceStore } from './sync-divergence-store';
import { divergenceHash } from './divergence-hash';

// Distributed sync S7: same-version divergence detection inside applyRemote.
//
// applyRemote's idempotency key is (resource_type, id, version). When two sides independently author
// the SAME version with DIFFERENT content — a lab re-edits a result to v2 while central amends it to
// v2 — the pre-S7 existence check found the key present and returned 'skipped', silently dropping the
// incoming edit while both cursors advanced. These tests pin that such a drop is now DETECTED and
// RECORDED, and — just as importantly — that a genuine re-drain is still an ordinary silent skip.
//
// Harness idiom copied from fhir-store-apply.test.ts: makeMigratedDb() (all migrations on pg-mem) +
// db.destroy() per test.

const OBS = 'Observation';

function upsert(version: number, siteId: string, body: Record<string, unknown>): RemoteRecord {
  return { resourceType: OBS, id: 'obs-1', version, op: 'upsert', siteId, resource: body as never };
}

function tombstone(version: number, siteId: string): RemoteRecord {
  return { resourceType: OBS, id: 'obs-1', version, op: 'delete', siteId };
}

function obs(status: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { resourceType: OBS, id: 'obs-1', status, ...extra };
}

/** v1 common ancestor, applied the same way both sides would have replicated it. */
async function seeded(): Promise<{ db: Kysely<any>; store: ReturnType<typeof createFhirStore> }> {
  const db = await makeMigratedDb();
  const store = createFhirStore(db as any);
  expect(await store.applyRemote(upsert(1, 'lab-a', obs('preliminary')))).toBe('applied');
  return { db, store };
}

async function canonicalBody(db: Kysely<any>, id = 'obs-1'): Promise<any> {
  const row = await db
    .selectFrom('fhir.fhir_resources')
    .select('resource')
    .where('resource_type', '=', OBS)
    .where('id', '=', id)
    .executeTakeFirstOrThrow();
  return row.resource;
}

describe('fhir-store applyRemote — same-version divergence', () => {
  it('same version + DIFFERENT content → diverged + exactly one row holding the dropped body', async () => {
    const { db, store } = await seeded();

    // The lab's own v2 lands first; central's independently-authored v2 arrives after.
    expect(await store.applyRemote(upsert(2, 'lab-a', obs('final')))).toBe('applied');
    expect(await store.applyRemote(upsert(2, 'central', obs('amended')))).toBe('diverged');

    const divergences = createSyncDivergenceStore(db as any);
    const rows = await divergences.list();
    expect(rows).toHaveLength(1);
    expect(rows[0].resourceType).toBe(OBS);
    expect(rows[0].resourceId).toBe('obs-1');
    expect(rows[0].version).toBe(2);
    expect(rows[0].incomingSiteId).toBe('central'); // the ORIGIN of the dropped content, not the local site
    expect(rows[0].localHash).not.toBeNull();
    expect(rows[0].incomingHash).not.toBeNull();
    expect(rows[0].localHash).not.toBe(rows[0].incomingHash);

    // The dropped content is recoverable in full — an operator must be able to diff offline.
    const row = await divergences.get(OBS, 'obs-1', 2);
    expect((row?.incomingBody as any).status).toBe('amended');
    // The hashes are the REAL comparison basis, not opaque strings.
    expect(row?.incomingHash).toBe(divergenceHash(obs('amended')));
    expect(row?.localHash).toBe(divergenceHash(obs('final')));

    await db.destroy();
  });

  it('does NOT overwrite the canonical row on divergence (the local copy is kept)', async () => {
    const { db, store } = await seeded();

    await store.applyRemote(upsert(2, 'lab-a', obs('final')));
    await store.applyRemote(upsert(2, 'central', obs('amended')));

    // Detect-and-surface only: no auto-heal, no last-writer-wins. The local copy stands.
    expect((await canonicalBody(db)).status).toBe('final');

    // The diverged path writes NOTHING to history or change_log either — v2 appears exactly once
    // (from the lab's apply), so the projection/sync streams never see a phantom second change.
    const hist = await db.selectFrom('fhir.resource_history').select(['version', 'op']).where('id', '=', 'obs-1').execute();
    expect(hist.map((h: any) => Number(h.version)).sort()).toEqual([1, 2]);
    const log = await db.selectFrom('fhir.change_log').select(['version', 'site_id']).where('resource_id', '=', 'obs-1').execute();
    expect(log).toHaveLength(2);
    expect(log.every((l: any) => l.site_id === 'lab-a')).toBe(true);

    await db.destroy();
  });

  it('same version + IDENTICAL content → skipped, NO row (idempotent re-drain unchanged)', async () => {
    const { db, store } = await seeded();

    expect(await store.applyRemote(upsert(2, 'lab-a', obs('final')))).toBe('applied');
    // The ordinary case by volume: a re-delivered record. Must stay a silent skip.
    expect(await store.applyRemote(upsert(2, 'lab-a', obs('final')))).toBe('skipped');

    expect(await createSyncDivergenceStore(db as any).list()).toHaveLength(0);

    await db.destroy();
  });

  it('content differing ONLY in volatile meta → skipped, NO row (the false-positive guard)', async () => {
    const { db, store } = await seeded();

    // meta.versionId / meta.lastUpdated are server-stamped and volatile. Two sides holding identical
    // content that differs only in those stamps lost NOTHING. If this ever reports a divergence, every
    // routine re-drain becomes noise and an operator stops reading the table at all — at which point
    // the real divergences this feature exists to surface go unseen too.
    const stamped = (lastUpdated: string) => obs('final', { meta: { versionId: '2', lastUpdated } });
    expect(await store.applyRemote(upsert(2, 'lab-a', stamped('2026-01-01T00:00:00.000Z')))).toBe('applied');
    expect(await store.applyRemote(upsert(2, 'central', stamped('2099-12-31T23:59:59.999Z')))).toBe('skipped');

    expect(await createSyncDivergenceStore(db as any).list()).toHaveLength(0);

    await db.destroy();
  });

  it('a body that omits id does NOT falsely diverge from the id-normalized stored copy', async () => {
    const { db, store } = await seeded();

    // applyRemote stores JSON.stringify({ ...record.resource, id }) — the id is normalized IN. The
    // incoming side must be hashed in that same normalized shape, or a wire body that merely omits id
    // (redundant with the record's own id, and not validated at the /api/sync/push trust boundary)
    // would manufacture a divergence out of nothing.
    expect(await store.applyRemote(upsert(2, 'lab-a', obs('final')))).toBe('applied');
    const { id: _dropped, ...noId } = obs('final');
    expect(await store.applyRemote(upsert(2, 'lab-a', noId))).toBe('skipped');

    expect(await createSyncDivergenceStore(db as any).list()).toHaveLength(0);

    await db.destroy();
  });

  it('tombstone vs tombstone → skipped, NO row (two deletes agree)', async () => {
    const { db, store } = await seeded();

    expect(await store.applyRemote(tombstone(2, 'lab-a'))).toBe('applied');
    // NULL-aware: null vs null AGREES. Nothing was lost — both sides deleted the same version.
    expect(await store.applyRemote(tombstone(2, 'central'))).toBe('skipped');

    expect(await createSyncDivergenceStore(db as any).list()).toHaveLength(0);

    await db.destroy();
  });

  it('local tombstone vs incoming body → diverged (delete-vs-edit)', async () => {
    const { db, store } = await seeded();

    expect(await store.applyRemote(tombstone(2, 'lab-a'))).toBe('applied');
    expect(await store.applyRemote(upsert(2, 'central', obs('amended')))).toBe('diverged');

    const row = await createSyncDivergenceStore(db as any).get(OBS, 'obs-1', 2);
    expect(row?.localHash).toBeNull(); // we kept a delete
    expect(row?.incomingHash).not.toBeNull(); // we dropped an edit
    expect((row?.incomingBody as any).status).toBe('amended');

    // The delete stands: the canonical row is still gone.
    expect(await store.get(OBS, 'obs-1')).toBeNull();

    await db.destroy();
  });

  it('local body vs incoming tombstone → diverged, NULL incoming hash/body persisted', async () => {
    const { db, store } = await seeded();

    expect(await store.applyRemote(upsert(2, 'lab-a', obs('final')))).toBe('applied');
    expect(await store.applyRemote(tombstone(2, 'central'))).toBe('diverged');

    const row = await createSyncDivergenceStore(db as any).get(OBS, 'obs-1', 2);
    expect(row?.localHash).not.toBeNull();
    expect(row?.incomingHash).toBeNull();
    expect(row?.incomingBody).toBeNull();

    // The dropped delete did NOT take the canonical row with it.
    expect((await canonicalBody(db)).status).toBe('final');

    await db.destroy();
  });

  it('re-delivery of a diverged record → still diverged, no duplicate, no detected_at churn', async () => {
    const { db, store } = await seeded();

    await store.applyRemote(upsert(2, 'lab-a', obs('final')));
    expect(await store.applyRemote(upsert(2, 'central', obs('amended')))).toBe('diverged');

    const divergences = createSyncDivergenceStore(db as any);
    const first = await divergences.get(OBS, 'obs-1', 2);
    const firstDetectedAt = first!.detectedAt.getTime();

    // A stuck redelivery loop must keep reporting 'diverged' (the caller's tally stays honest) while
    // neither inflating the table nor moving the FIRST-detection timestamp.
    expect(await store.applyRemote(upsert(2, 'central', obs('amended')))).toBe('diverged');
    expect(await divergences.list()).toHaveLength(1);
    expect((await divergences.get(OBS, 'obs-1', 2))!.detectedAt.getTime()).toBe(firstDetectedAt);

    await db.destroy();
  });

  it('divergences at v2 and v5 on one resource are independent rows', async () => {
    const { db, store } = await seeded();

    await store.applyRemote(upsert(2, 'lab-a', obs('final')));
    expect(await store.applyRemote(upsert(2, 'central', obs('amended')))).toBe('diverged');
    await store.applyRemote(upsert(5, 'lab-a', obs('corrected')));
    expect(await store.applyRemote(upsert(5, 'central', obs('entered-in-error')))).toBe('diverged');

    const rows = await createSyncDivergenceStore(db as any).list();
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.version).sort()).toEqual([2, 5]);

    await db.destroy();
  });

  it('a normal first apply at a new version still returns applied and records nothing', async () => {
    const { db, store } = await seeded();

    expect(await store.applyRemote(upsert(2, 'lab-a', obs('final')))).toBe('applied');
    expect((await canonicalBody(db)).status).toBe('final');
    expect(await createSyncDivergenceStore(db as any).list()).toHaveLength(0);

    await db.destroy();
  });
});
