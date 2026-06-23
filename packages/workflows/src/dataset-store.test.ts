import { describe, it, expect, beforeEach } from 'vitest';
import { Kysely } from 'kysely';
import { newDb } from 'pg-mem';
import { createWorkflowDatasetStore } from './dataset-store';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: Kysely<any>;
beforeEach(async () => {
  db = newDb().adapters.createKysely();
  await db.schema.createTable('workflow_datasets')
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('name', 'text', (c) => c.unique())
    .addColumn('columns', 'jsonb').addColumn('rows', 'jsonb')
    .addColumn('row_count', 'integer').addColumn('workflow_id', 'text')
    .addColumn('created_at', 'text').addColumn('updated_at', 'text')
    .addColumn('published_table', 'text')
    .execute();
});

describe('WorkflowDatasetStore', () => {
  it('upserts by name (latest wins), lists, gets', async () => {
    const store = createWorkflowDatasetStore(db);
    await store.upsertByName({ name: 'amr', columns: [{ key: 'a', label: 'A' }], rows: [{ a: 1 }], rowCount: 1, workflowId: 'w1' });
    await store.upsertByName({ name: 'amr', columns: [{ key: 'a', label: 'A' }], rows: [{ a: 1 }, { a: 2 }], rowCount: 2, workflowId: 'w1' });
    const list = await store.list();
    expect(list.length).toBe(1);
    expect(list[0].rowCount).toBe(2);
    expect((await store.getByName('amr'))?.rows.length).toBe(2);
    expect(await store.getByName('nope')).toBeUndefined();
    await store.markPublished('amr', 'wf_ds_amr');
    expect((await store.getByName('amr'))?.publishedTable).toBe('wf_ds_amr');
    expect((await store.list())[0].publishedTable).toBe('wf_ds_amr');
  });
});
