import { describe, expect, it } from 'vitest';
import type { AppSettingRecord, AppSettingStore } from '@openldr/db';
import { migrateLegacySyncConfig } from './sync-settings-migrate';

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

const legacyBlob = JSON.stringify({
  enabled: true,
  mode: 'push',
  centralUrl: 'https://c',
  siteId: 's',
  intervalMinutes: 30,
});

describe('migrateLegacySyncConfig', () => {
  it('copies a legacy blob into discrete keys and tombstones it', async () => {
    const store = fakeStore({ 'sync.config': legacyBlob });
    const result = await migrateLegacySyncConfig(store);
    expect(result).toBe(true);
    expect(store.data.get('sync.enabled')).toBe('true');
    expect(store.data.get('sync.mode')).toBe('push');
    expect(store.data.get('sync.central_url')).toBe('https://c');
    expect(store.data.get('sync.site_id')).toBe('s');
    expect(store.data.get('sync.interval_minutes')).toBe('30');
    // blob tombstoned (empty value, not deleted)
    expect(store.data.get('sync.config')).toBe('');
  });

  it('is idempotent: a second run is a no-op', async () => {
    const store = fakeStore({ 'sync.config': legacyBlob });
    expect(await migrateLegacySyncConfig(store)).toBe(true);
    expect(await migrateLegacySyncConfig(store)).toBe(false);
  });

  it('returns false when no blob is present', async () => {
    expect(await migrateLegacySyncConfig(fakeStore())).toBe(false);
  });

  it('returns false when discrete keys already exist (no overwrite)', async () => {
    const store = fakeStore({ 'sync.config': legacyBlob, 'sync.enabled': 'false' });
    expect(await migrateLegacySyncConfig(store)).toBe(false);
    // discrete key untouched, blob left intact
    expect(store.data.get('sync.enabled')).toBe('false');
    expect(store.data.get('sync.config')).toBe(legacyBlob);
  });

  it('returns false when the blob is already tombstoned', async () => {
    expect(await migrateLegacySyncConfig(fakeStore({ 'sync.config': '' }))).toBe(false);
  });
});
