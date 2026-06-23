import { describe, it, expect, beforeEach } from 'vitest';
import { Kysely } from 'kysely';
import { newDb } from 'pg-mem';
import { createWorkflowStore } from './store';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: Kysely<any>;
beforeEach(async () => {
  const mem = newDb();
  db = mem.adapters.createKysely();
  await db.schema.createTable('workflows')
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('name', 'text')
    .addColumn('description', 'text')
    .addColumn('definition', 'jsonb')
    .addColumn('enabled', 'boolean')
    .addColumn('created_by', 'text')
    .addColumn('created_at', 'text')
    .addColumn('updated_at', 'text')
    .execute();
});

describe('WorkflowStore', () => {
  it('creates, lists, gets, updates, deletes', async () => {
    const store = createWorkflowStore(db);
    const created = await store.create({
      id: 'w1', name: 'Main', description: null,
      definition: { nodes: [], edges: [] }, enabled: true, createdBy: null,
    });
    expect(created.name).toBe('Main');
    expect((await store.list()).length).toBe(1);
    await store.update('w1', { ...created, name: 'Renamed' });
    expect((await store.get('w1'))?.name).toBe('Renamed');
    await store.remove('w1');
    expect(await store.get('w1')).toBeUndefined();
  });
});
