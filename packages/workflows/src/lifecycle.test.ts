import { describe, it, expect } from 'vitest';
import { buildLifecycle, type LifecycleInputs } from './lifecycle';

const run = (over: Partial<any>) => ({ id: 'r', workflowId: 'w', triggerSource: 'webhook', status: 'completed',
  startedAt: '2026-07-03T10:00:00Z', finishedAt: '2026-07-03T10:00:01Z', error: null, correlationId: 'A',
  result: { results: [] }, ...over });

it('assembles received -> validated -> persisted -> pushed', () => {
  const inputs: LifecycleInputs = {
    correlationId: 'A',
    runs: [
      run({ id: 'r1', triggerSource: 'webhook', result: { results: [
        { nodeId: 'validate', nodeType: 'form-validate', status: 'success' },
        { nodeId: 'persist', nodeType: 'persist-store', status: 'success', meta: { batchId: 'A', persisted: 2, resourceTypes: ['ServiceRequest'] } },
      ] } }),
      run({ id: 'r2', triggerSource: 'event', startedAt: '2026-07-03T10:00:05Z', result: { results: [
        { nodeId: 'push', nodeType: 'dhis2-sink', status: 'success' },
      ] } }),
    ],
    persistedEvent: { at: '2026-07-03T10:00:02Z', count: 2, resourceTypes: ['ServiceRequest'] },
    ingestBatch: null,
  };
  const lc = buildLifecycle(inputs);
  expect(lc.stages.map((s) => s.stage)).toEqual(['received', 'validated', 'persisted', 'pushed']);
  expect(lc.status).toBe('complete');
});

it('marks a payload stuck when never persisted', () => {
  const lc = buildLifecycle({ correlationId: 'A', ingestBatch: null, persistedEvent: null,
    runs: [run({ result: { results: [{ nodeId: 'validate', nodeType: 'form-validate', status: 'success' }] } })] });
  expect(lc.status).toBe('stuck');
  expect(lc.stages.map((s) => s.stage)).toEqual(['received', 'validated']);
});

it('marks failed when a run failed', () => {
  const lc = buildLifecycle({ correlationId: 'A', ingestBatch: null, persistedEvent: null,
    runs: [run({ status: 'failed', error: 'boom', result: { results: [] } })] });
  expect(lc.status).toBe('failed');
});
