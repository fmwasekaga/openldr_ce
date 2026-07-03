import { describe, it, expect } from 'vitest';
import { makeMigratedDb } from '@openldr/db/testing';
import { createWorkflowRunStore } from '@openldr/workflows';
import { createActivityService } from './index';

/**
 * End-to-end assembly of the payload lifecycle against a fully-migrated DB.
 * Proves that a real run store + a real `data.persisted` outbox event + the
 * activity service together yield the full received→validated→persisted→pushed
 * lifecycle and surface it in the recent-payloads list.
 */
describe('activity lifecycle end-to-end assembly', () => {
  it('assembles a complete lifecycle from real runs + a real outbox event', async () => {
    const db = await makeMigratedDb();
    const runs = createWorkflowRunStore(db);

    // 1. Originating run (webhook) — Form Validate + Persist Store both succeed.
    await runs.record({
      id: 'r1', workflowId: 'w', triggerSource: 'webhook', status: 'completed',
      startedAt: '2026-07-03T10:00:00Z', finishedAt: '2026-07-03T10:00:01Z', error: null, correlationId: 'X',
      result: { results: [
        { nodeId: 'validate', nodeType: 'form-validate', status: 'success' },
        { nodeId: 'persist', nodeType: 'persist-store', status: 'success', meta: { batchId: 'X', persisted: 2, resourceTypes: ['ServiceRequest'] } },
      ] },
    });

    // 2. The data.persisted outbox event for batch 'X' (defaults fill status/attempts/
    //    max_attempts/available_at/updated_at; created_at set explicitly for ordering).
    await db.insertInto('outbox_events' as never).values({
      id: 'oe1',
      type: 'data.persisted',
      payload: JSON.stringify({ batchId: 'X', count: 2, resourceTypes: ['ServiceRequest'] }),
      batch_id: 'X',
      created_at: '2026-07-03T10:00:02Z',
    } as never).execute();

    // 3. Reactive run (event) — a sink/push node succeeds, started slightly later.
    await runs.record({
      id: 'r2', workflowId: 'w-reactive', triggerSource: 'event', status: 'completed',
      startedAt: '2026-07-03T10:00:03Z', finishedAt: '2026-07-03T10:00:04Z', error: null, correlationId: 'X',
      result: { results: [
        { nodeId: 'push', nodeType: 'dhis2-sink', status: 'success' },
      ] },
    });

    // 4. Activity service wired against the real DB. A null batch is fine — this
    //    payload arrived via webhook, not ingest.
    const persistedEvent = async (id: string) => {
      const row = await db.selectFrom('outbox_events' as never).select(['payload', 'created_at'] as never)
        .where('batch_id' as never, '=', id as never).where('type' as never, '=', 'data.persisted' as never)
        .orderBy('created_at' as never, 'asc').executeTakeFirst() as { payload: unknown; created_at: unknown } | undefined;
      if (!row) return null;
      const p = (typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload) as { count?: number; resourceTypes?: string[] };
      return { at: String(row.created_at), count: p.count ?? 0, resourceTypes: p.resourceTypes ?? [] };
    };
    const svc = createActivityService({ runs, batches: { get: async () => null }, persistedEvent });

    // 5. Full lifecycle assembled end-to-end.
    const lc = await svc.getLifecycle('X');
    expect(lc).not.toBeNull();
    expect(lc!.status).toBe('complete');
    expect(lc!.stages.map((s) => s.stage)).toEqual(['received', 'validated', 'persisted', 'pushed']);

    // 6. And it surfaces in the recent-payloads list at the pushed stage.
    const list = await svc.listRecent({ limit: 10, offset: 0 });
    const entry = list.find((e) => e.correlationId === 'X');
    expect(entry).toBeDefined();
    expect(entry!.currentStage).toBe('pushed');
  });
});
