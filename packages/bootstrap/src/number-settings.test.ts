import { describe, expect, it } from 'vitest';
import type { AppSettingRecord, AppSettingStore } from '@openldr/db';
import { createNumberSettings } from './number-settings';

function fakeStore(initial: Record<string, string> = {}): AppSettingStore & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    async get(key: string): Promise<AppSettingRecord | null> {
      const value = data.get(key);
      return value == null ? null : { key, value, updatedAt: new Date(0), updatedBy: null };
    },
    async getAll() {
      return [...data.entries()].map(([key, value]) => ({ key, value, updatedAt: new Date(0), updatedBy: null }));
    },
    async set(key: string, value: string) {
      data.set(key, value);
    },
  };
}

describe('number settings resolver', () => {
  it('returns the registry default when unset', async () => {
    const ns = createNumberSettings(fakeStore());
    expect(await ns.get('dashboard.sql_timeout_ms')).toBe(5000);
  });

  it('persists and round-trips a value (invalidating the cache)', async () => {
    const store = fakeStore();
    const ns = createNumberSettings(store);
    const saved = await ns.set('dashboard.sql_row_cap', 2500, 'admin');
    expect(saved).toBe(2500);
    expect(store.data.get('dashboard.sql_row_cap')).toBe('2500');
    expect(await ns.get('dashboard.sql_row_cap')).toBe(2500);
  });

  it('clamps out-of-range values on set', async () => {
    const ns = createNumberSettings(fakeStore());
    expect(await ns.set('dashboard.sql_row_cap', 0, 'admin')).toBe(1); // below min
  });

  it('throws on an unknown setting id', async () => {
    const ns = createNumberSettings(fakeStore());
    await expect(ns.get('nope.nope')).rejects.toThrow();
    await expect(ns.set('nope.nope', 1, 'admin')).rejects.toThrow();
  });

  it('all() exposes id/value/min/max for every registered setting', async () => {
    const all = await createNumberSettings(fakeStore()).all();
    expect(all.length).toBeGreaterThan(0);
    for (const s of all) {
      expect(s.min).toBeLessThanOrEqual(s.value);
      expect(s.value).toBeLessThanOrEqual(s.max);
    }
  });
});
