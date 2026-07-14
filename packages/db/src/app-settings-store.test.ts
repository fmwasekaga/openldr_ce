import { describe, it, expect, beforeEach } from 'vitest';
import { makeMigratedDb } from './migrations/internal/test-helpers';
import { createAppSettingsStore } from './app-settings-store';
import { referenceCapture } from './reference-capture';

async function refLog(db: Awaited<ReturnType<typeof makeMigratedDb>>, entityId: string) {
  return db.selectFrom('reference_change_log').selectAll().where('entity_id', '=', entityId).orderBy('seq').execute();
}

describe('createAppSettingsStore', () => {
  let db: Awaited<ReturnType<typeof makeMigratedDb>>;
  beforeEach(async () => { db = await makeMigratedDb(); });

  it('sets and reads a value (upsert on repeat)', async () => {
    const store = createAppSettingsStore(db);
    await store.set('dashboard.raw_sql', 'true', 'admin');
    expect((await store.get('dashboard.raw_sql'))?.value).toBe('true');
    await store.set('dashboard.raw_sql', 'false', 'admin');
    expect((await store.get('dashboard.raw_sql'))?.value).toBe('false');
  });

  it('without capture: no reference_change_log rows', async () => {
    const store = createAppSettingsStore(db);
    await store.set('dashboard.raw_sql', 'true', 'admin');
    expect(await refLog(db, 'dashboard.raw_sql')).toHaveLength(0);
  });

  it('with capture: allowlisted key → upsert capture', async () => {
    const store = createAppSettingsStore(db, referenceCapture);
    await store.set('dashboard.raw_sql', 'true', 'admin');
    const log = await refLog(db, 'dashboard.raw_sql');
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ entity_type: 'setting', op: 'upsert' });
    expect(log[0].content_hash).toBeTruthy();
  });

  it('with capture: non-allowlisted (sync.*) key → NO capture', async () => {
    const store = createAppSettingsStore(db, referenceCapture);
    await store.set('sync.central_url', 'https://central.example', 'admin');
    expect(await refLog(db, 'sync.central_url')).toHaveLength(0);
    // value is still stored — only the capture is suppressed.
    expect((await store.get('sync.central_url'))?.value).toBe('https://central.example');
  });
});
