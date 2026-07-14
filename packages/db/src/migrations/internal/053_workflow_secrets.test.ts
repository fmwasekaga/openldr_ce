import { describe, it, expect } from 'vitest';
import { makeMigratedDb } from './test-helpers';

describe('053_workflow_secrets', () => {
  it('creates the workflow_secrets table with the expected columns', async () => {
    const db = await makeMigratedDb();

    await db.insertInto('workflow_secrets').values({
      id: 'wsec_1', workflow_id: 'wf1', sealed_value: 'sealed-blob',
    } as never).execute();

    const row = await db.selectFrom('workflow_secrets').selectAll().where('id', '=', 'wsec_1').executeTakeFirst();
    expect(row).toBeTruthy();
    expect((row as any).workflow_id).toBe('wf1');
    expect((row as any).sealed_value).toBe('sealed-blob');
    // created_at is defaulted (now()) so it is populated even when omitted on insert.
    expect((row as any).created_at).toBeTruthy();

    await db.destroy();
  });
});
