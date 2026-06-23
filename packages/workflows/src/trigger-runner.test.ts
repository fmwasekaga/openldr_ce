import { describe, it, expect, vi } from 'vitest';
import { createWorkflowTriggerRunner } from './trigger-runner';
import { runWorkflow } from './engine/run-workflow';

function fakeEventing() {
  const handlers = new Map<string, (e: { type: string; payload: unknown }) => Promise<void>>();
  const published: Array<{ type: string; payload: unknown; availableAt?: Date }> = [];
  return {
    handlers,
    published,
    port: {
      healthCheck: async () => ({ ok: true } as never),
      publish: async (e: never, o?: { availableAt?: Date }) => {
        published.push({ ...(e as object), availableAt: o?.availableAt } as never);
      },
      subscribe: async (t: string, h: never) => {
        handlers.set(t, h as never);
      },
    },
  };
}

const wfWith = (nodes: unknown[], edges: unknown[] = []) => ({
  id: 'w1',
  name: 'W',
  description: null,
  definition: { nodes, edges },
  enabled: true,
  createdBy: null,
});

describe('workflow trigger runner', () => {
  it('on schedule.due: runs the workflow, records it, and re-arms', async () => {
    const ev = fakeEventing();
    const recorded: unknown[] = [];
    const runner = createWorkflowTriggerRunner({
      store: { get: async () => wfWith([{ id: 't', type: 'trigger', data: {} }]) } as never,
      runs: { record: async (r: unknown) => { recorded.push(r); } } as never,
      schedules: {
        get: async () => ({
          workflowId: 'w1', nodeId: 's', cron: '0 9 * * *', tz: 'UTC',
          enabled: true, nextDueAt: null,
        }),
        list: async () => [],
        setNextDue: async () => {},
      } as never,
      webhooks: { resolve: () => undefined } as never,
      runWorkflow,
      logger: { error: () => {}, warn: () => {} },
    });

    await runner.registerRunner(ev.port as never);
    await ev.handlers.get('workflow.schedule.due')!({
      type: 'workflow.schedule.due',
      payload: { workflowId: 'w1', nodeId: 's' },
    });

    expect(recorded.length).toBe(1);
    expect(ev.published.some((p) => p.type === 'workflow.schedule.due' && p.availableAt instanceof Date)).toBe(true);
  });

  it('skips run when schedule is disabled', async () => {
    const ev = fakeEventing();
    const recorded: unknown[] = [];
    const runner = createWorkflowTriggerRunner({
      store: { get: async () => wfWith([]) } as never,
      runs: { record: async (r: unknown) => { recorded.push(r); } } as never,
      schedules: {
        get: async () => ({
          workflowId: 'w1', nodeId: 's', cron: '0 9 * * *', tz: 'UTC',
          enabled: false, nextDueAt: null,
        }),
        list: async () => [],
        setNextDue: async () => {},
      } as never,
      webhooks: { resolve: () => undefined } as never,
      runWorkflow,
      logger: { error: () => {}, warn: () => {} },
    });

    await runner.registerRunner(ev.port as never);
    await ev.handlers.get('workflow.schedule.due')!({
      type: 'workflow.schedule.due',
      payload: { workflowId: 'w1', nodeId: 's' },
    });

    expect(recorded.length).toBe(0);
    expect(ev.published.length).toBe(0);
  });

  it('on ingest.batch.done: runs workflows whose trigger set includes ingest', async () => {
    const ev = fakeEventing();
    const recorded: unknown[] = [];
    const runner = createWorkflowTriggerRunner({
      store: {
        get: async () => wfWith([{ id: 'i', type: 'trigger', data: { triggerType: 'ingest' } }]),
      } as never,
      runs: { record: async (r: unknown) => { recorded.push(r); } } as never,
      schedules: {
        list: async () => [],
        get: async () => undefined,
        setNextDue: async () => {},
      } as never,
      webhooks: { resolve: () => undefined } as never,
      runWorkflow,
      logger: { error: () => {}, warn: () => {} },
    });

    runner.setIngestWorkflowIds(['w1']);
    await runner.registerRunner(ev.port as never);
    await ev.handlers.get('ingest.batch.done')!({
      type: 'ingest.batch.done',
      payload: { source: 'whonet', count: 3 },
    });

    expect(recorded.length).toBe(1);
    expect((recorded[0] as { triggerSource: string }).triggerSource).toBe('ingest');
  });

  it('ingest sourceFilter: skips workflows whose filter does not match the batch source', async () => {
    const ev = fakeEventing();
    const recorded: unknown[] = [];
    const runner = createWorkflowTriggerRunner({
      store: {
        get: async () => wfWith([
          { id: 'i', type: 'trigger', data: { triggerType: 'ingest', config: { sourceFilter: 'whonet' } } },
        ]),
      } as never,
      runs: { record: async (r: unknown) => { recorded.push(r); } } as never,
      schedules: { list: async () => [], get: async () => undefined, setNextDue: async () => {} } as never,
      webhooks: { resolve: () => undefined } as never,
      runWorkflow,
      logger: { error: () => {}, warn: () => {} },
    });

    runner.setIngestWorkflowIds(['w1']);
    await runner.registerRunner(ev.port as never);

    // Non-matching source → skipped.
    await ev.handlers.get('ingest.batch.done')!({ type: 'ingest.batch.done', payload: { source: 'dhis2', count: 1 } });
    expect(recorded.length).toBe(0);

    // Matching source (case-insensitive) → runs.
    await ev.handlers.get('ingest.batch.done')!({ type: 'ingest.batch.done', payload: { source: 'WHONET', count: 1 } });
    expect(recorded.length).toBe(1);
  });

  it('reconcile arms schedules with no future nextDueAt', async () => {
    const ev = fakeEventing();
    const setNextDueCalls: unknown[] = [];
    const runner = createWorkflowTriggerRunner({
      store: { get: async () => wfWith([]) } as never,
      runs: { record: async () => {} } as never,
      schedules: {
        list: async () => [
          { workflowId: 'w1', nodeId: 'n1', cron: '0 9 * * *', tz: 'UTC', enabled: true, nextDueAt: null },
        ],
        get: async () => undefined,
        setNextDue: async (...args: unknown[]) => { setNextDueCalls.push(args); },
      } as never,
      webhooks: { resolve: () => undefined } as never,
      runWorkflow,
      logger: { error: () => {}, warn: () => {} },
    });

    await runner.reconcile(ev.port as never);
    expect(setNextDueCalls.length).toBe(1);
    expect(ev.published.some((p) => p.type === 'workflow.schedule.due')).toBe(true);
  });

  it('reconcile skips schedules already armed in the future', async () => {
    const ev = fakeEventing();
    const futureDate = new Date(Date.now() + 60_000).toISOString();
    const runner = createWorkflowTriggerRunner({
      store: { get: async () => wfWith([]) } as never,
      runs: { record: async () => {} } as never,
      schedules: {
        list: async () => [
          { workflowId: 'w1', nodeId: 'n1', cron: '0 9 * * *', tz: 'UTC', enabled: true, nextDueAt: futureDate },
        ],
        get: async () => undefined,
        setNextDue: async () => {},
      } as never,
      webhooks: { resolve: () => undefined } as never,
      runWorkflow,
      logger: { error: () => {}, warn: () => {} },
    });

    await runner.reconcile(ev.port as never);
    expect(ev.published.length).toBe(0);
  });
});
