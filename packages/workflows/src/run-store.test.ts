import { describe, it, expect, beforeEach } from 'vitest';
import { Kysely } from 'kysely';
import { newDb } from 'pg-mem';
import { makeMigratedDb } from '@openldr/db/testing';
import { createWorkflowRunStore } from './run-store';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: Kysely<any>;
beforeEach(async () => {
  db = newDb().adapters.createKysely();
  await db.schema.createTable('workflow_runs')
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('workflow_id', 'text')
    .addColumn('trigger_source', 'text')
    .addColumn('status', 'text')
    .addColumn('started_at', 'text')
    .addColumn('finished_at', 'text')
    .addColumn('result', 'jsonb')
    .addColumn('error', 'text')
    .addColumn('correlation_id', 'text')
    .execute();
});

describe('WorkflowRunStore', () => {
  it('records, lists by workflow, gets by id', async () => {
    const store = createWorkflowRunStore(db);
    await store.record({
      id: 'r1', workflowId: 'w1', triggerSource: 'manual', status: 'completed',
      startedAt: '2026-01-01T00:00:00Z', finishedAt: '2026-01-01T00:00:01Z',
      result: { status: 'completed', results: [] }, error: null,
    });
    const list = await store.list('w1', { limit: 10, offset: 0 });
    expect(list.length).toBe(1);
    expect(list[0].triggerSource).toBe('manual');
    expect((await store.get('r1'))?.id).toBe('r1');
    expect(await store.get('nope')).toBeUndefined();
  });

  it('records and queries runs by correlation id', async () => {
    const db = await makeMigratedDb();
    const store = createWorkflowRunStore(db);
    const base = { workflowId: 'w1', triggerSource: 'webhook' as const, status: 'completed' as const,
      startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), result: {}, error: null };
    await store.record({ ...base, id: 'r1', correlationId: 'batch-A' });
    await store.record({ ...base, id: 'r2', correlationId: 'batch-A' });
    await store.record({ ...base, id: 'r3', correlationId: null });
    const byId = await store.listByCorrelation('batch-A');
    expect(byId.map((r) => r.id).sort()).toEqual(['r1', 'r2']);
    const recent = await store.listCorrelations({ limit: 10, offset: 0 });
    expect(recent.map((c) => c.correlationId)).toContain('batch-A');
  });
});
