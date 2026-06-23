import { describe, it, expect, beforeEach } from 'vitest';
import { Kysely } from 'kysely';
import { newDb } from 'pg-mem';
import { createWorkflowScheduleStore } from './schedule-store';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: Kysely<any>;
beforeEach(async () => {
  db = newDb().adapters.createKysely();
  await db.schema.createTable('workflow_schedules')
    .addColumn('workflow_id', 'text')
    .addColumn('node_id', 'text')
    .addColumn('cron', 'text')
    .addColumn('tz', 'text')
    .addColumn('enabled', 'boolean')
    .addColumn('next_due_at', 'text')
    .execute();
});

describe('WorkflowScheduleStore', () => {
  it('upserts, lists enabled, sets next due, removes per workflow', async () => {
    const store = createWorkflowScheduleStore(db);
    await store.upsert({ workflowId: 'w1', nodeId: 'n1', cron: '0 9 * * *', tz: 'UTC', enabled: true, nextDueAt: null });
    await store.upsert({ workflowId: 'w1', nodeId: 'n1', cron: '0 10 * * *', tz: 'UTC', enabled: true, nextDueAt: null }); // update
    expect((await store.list({ enabledOnly: true })).length).toBe(1);
    await store.setNextDue('w1', 'n1', '2026-01-01T10:00:00Z');
    expect((await store.get('w1', 'n1'))?.nextDueAt).toBe('2026-01-01T10:00:00Z');
    await store.removeForWorkflow('w1');
    expect((await store.list({})).length).toBe(0);
  });
});
