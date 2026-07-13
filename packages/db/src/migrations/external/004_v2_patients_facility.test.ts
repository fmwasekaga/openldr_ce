import { describe, expect, it } from 'vitest';
import { makeMigratedExternalDb } from '../../test-helpers-external';

describe('004 v2_patients.managing_organization', () => {
  it('adds the managing_organization column', async () => {
    const db = await makeMigratedExternalDb();
    await db.insertInto('patients').values({ id: 'p1', managing_organization: 'Organization/org-1' }).execute();
    const row = await db.selectFrom('patients').select(['id', 'managing_organization']).executeTakeFirstOrThrow();
    expect(row.managing_organization).toBe('Organization/org-1');
    await db.destroy();
  });
});
