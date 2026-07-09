import { describe, expect, it } from 'vitest';
import type { AppSettingRecord, AppSettingStore } from '@openldr/db';
import { createReportCategoriesService, REPORT_CATEGORIES_SETTING_KEY } from './report-categories';

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
    async set(key: string, value: string, updatedBy: string | null) {
      data.set(key, value);
      void updatedBy;
    },
  };
}

describe('report categories service', () => {
  it('returns [] when the setting is unset', async () => {
    const svc = createReportCategoriesService(fakeStore());
    expect(await svc.list()).toEqual([]);
  });

  it('persists and round-trips a list', async () => {
    const store = fakeStore();
    const svc = createReportCategoriesService(store);
    const list = [
      { id: 'amr', label: 'AMR', order: 0 },
      { id: 'custom', label: 'Custom', order: 1 },
    ];
    await svc.save(list);
    expect(await svc.list()).toEqual(list);
    expect(store.data.has(REPORT_CATEGORIES_SETTING_KEY)).toBe(true);
  });

  it('save() validates and rejects an invalid list', async () => {
    const svc = createReportCategoriesService(fakeStore());
    await expect(svc.save([{ id: '', label: 'X', order: 0 }] as never)).rejects.toThrow();
  });

  it('list() falls back to [] on malformed stored JSON', async () => {
    const store = fakeStore({ [REPORT_CATEGORIES_SETTING_KEY]: 'not json' });
    const svc = createReportCategoriesService(store);
    expect(await svc.list()).toEqual([]);
  });

  it('a later save() overwrites the previous list entirely', async () => {
    const store = fakeStore();
    const svc = createReportCategoriesService(store);
    await svc.save([{ id: 'a', label: 'A', order: 0 }]);
    await svc.save([{ id: 'b', label: 'B', order: 0 }]);
    expect(await svc.list()).toEqual([{ id: 'b', label: 'B', order: 0 }]);
  });
});
