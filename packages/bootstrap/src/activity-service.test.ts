import { describe, it, expect } from 'vitest';
import { createActivityService } from './activity-service';

const runs = [
  { id: 'r1', workflowId: 'w', triggerSource: 'webhook', status: 'completed', startedAt: '2026-07-03T10:00:00Z',
    finishedAt: '2026-07-03T10:00:01Z', error: null, correlationId: 'A',
    result: { results: [{ nodeId: 'persist', nodeType: 'persist-store', status: 'success', meta: { batchId: 'A' } }] } },
];
const deps = {
  runs: { listByCorrelation: async (id: string) => runs.filter((r) => r.correlationId === id),
          listCorrelations: async () => [{ correlationId: 'A', latestAt: '2026-07-03T10:00:00Z', latestStatus: 'completed', workflowId: 'w' }] },
  batches: { get: async () => null },
  persistedEvent: async (_id: string) => ({ at: '2026-07-03T10:00:02Z', count: 1, resourceTypes: ['ServiceRequest'] }),
};

it('assembles a lifecycle for a correlation id', async () => {
  const svc = createActivityService(deps as any);
  const lc = await svc.getLifecycle('A');
  expect(lc?.status).toBe('complete');
  expect(lc?.stages.some((s) => s.stage === 'persisted')).toBe(true);
});

it('lists recent payloads', async () => {
  const svc = createActivityService(deps as any);
  const list = await svc.listRecent({ limit: 10, offset: 0 });
  expect(list[0].correlationId).toBe('A');
  expect(list[0].currentStage).toBe('persisted');
});
