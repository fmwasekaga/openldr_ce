import { describe, expect, it } from 'vitest';
import type { AppSettingRecord, AppSettingStore } from '@openldr/db';
import { DEFAULT_SYNC_CONFIG } from '@openldr/config';
import { getSyncConfig, setSyncConfig } from './sync-settings';

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

describe('sync settings', () => {
  it('returns defaults when nothing is stored', async () => {
    expect(await getSyncConfig(fakeStore())).toEqual(DEFAULT_SYNC_CONFIG);
  });

  it('persists a valid config as JSON under sync.config and round-trips it', async () => {
    const store = fakeStore();
    const saved = await setSyncConfig(
      store,
      { enabled: true, mode: 'push', centralUrl: 'https://central.example.org', siteId: 'lab-01', intervalMinutes: 30 },
      'tester',
    );
    expect(saved.mode).toBe('push');
    expect(store.data.get('sync.config')).toContain('central.example.org');
    expect(await getSyncConfig(store)).toEqual(saved);
  });

  it('rejects enabling sync without a central URL', async () => {
    await expect(
      setSyncConfig(fakeStore(), { enabled: true, siteId: 'lab-01', centralUrl: '' }, 'tester'),
    ).rejects.toThrow();
  });

  it('rejects a non-http central URL', async () => {
    await expect(
      setSyncConfig(fakeStore(), { centralUrl: 'ftp://nope' }, 'tester'),
    ).rejects.toThrow();
  });

  it('falls back to defaults on a corrupt stored value', async () => {
    expect(await getSyncConfig(fakeStore({ 'sync.config': 'not json' }))).toEqual(DEFAULT_SYNC_CONFIG);
  });
});
