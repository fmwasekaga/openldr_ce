import { describe, it, expect } from 'vitest';
import { createFeatureFlags } from './feature-flags';
import type { AppSettingStore, AppSettingRecord } from '@openldr/db';

function fakeStore(): AppSettingStore & { calls: number } {
  const map = new Map<string, AppSettingRecord>();
  const s = {
    calls: 0,
    async get(key: string) { return map.get(key) ?? null; },
    async getAll() { s.calls++; return [...map.values()]; },
    async set(key: string, value: string, updatedBy: string | null) {
      map.set(key, { key, value, updatedAt: new Date(0), updatedBy });
    },
  };
  return s as AppSettingStore & { calls: number };
}

describe('createFeatureFlags', () => {
  it('returns the registry default when unset', async () => {
    const ff = createFeatureFlags(fakeStore());
    expect(await ff.get('dashboard.raw_sql')).toBe(false);
  });

  it('reflects a stored override after set', async () => {
    const ff = createFeatureFlags(fakeStore());
    await ff.set('dashboard.raw_sql', true, 'admin');
    expect(await ff.get('dashboard.raw_sql')).toBe(true);
  });

  it('all() merges registry defaults with stored overrides', async () => {
    const ff = createFeatureFlags(fakeStore());
    await ff.set('dashboard.raw_sql', true, 'admin');
    const all = await ff.all();
    const flag = all.find((f) => f.id === 'dashboard.raw_sql');
    expect(flag?.value).toBe(true);
    expect(flag?.labelKey).toBe('settings.general.flags.dashboardRawSql.label');
  });

  it('caches getAll within the TTL and re-reads after set invalidates', async () => {
    const store = fakeStore();
    const ff = createFeatureFlags(store);
    await ff.get('dashboard.raw_sql');
    await ff.get('dashboard.raw_sql');
    expect(store.calls).toBe(1); // second read served from cache
    await ff.set('dashboard.raw_sql', true, 'admin'); // invalidates
    expect(await ff.get('dashboard.raw_sql')).toBe(true);
    expect(store.calls).toBe(2); // re-read after invalidation
  });
});
