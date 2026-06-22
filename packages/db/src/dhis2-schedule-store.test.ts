import { describe, expect, it } from 'vitest';
import { makeMigratedDb } from './migrations/internal/test-helpers';
import { createScheduleStore } from './dhis2-schedule-store';

describe('schedule store', () => {
  it('creates, lists, toggles enabled, and removes', async () => {
    const db = await makeMigratedDb();
    const store = createScheduleStore(db);
    await store.create({ id: 's1', mappingId: 'm1', mode: 'aggregate', periodType: 'quarterly', eventDriven: false });
    expect((await store.list()).map((s) => s.id)).toEqual(['s1']);
    expect((await store.get('s1'))?.enabled).toBe(true);

    await store.setEnabled('s1', false);
    expect((await store.get('s1'))?.enabled).toBe(false);
    await store.setEnabled('s1', true);
    expect((await store.get('s1'))?.enabled).toBe(true);

    await store.remove('s1');
    expect(await store.list()).toEqual([]);
    await db.destroy();
  });
});
