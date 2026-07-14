import { describe, it, expect, vi } from 'vitest';
import { executeWorkflowHandler } from './execute-workflow';
import { createContext } from '../execution-context';
import type { WorkflowServices } from '../services';
import type { RunEvent } from '../../types';

const node = (config: Record<string, unknown>) => ({
  id: 'x', type: 'action', data: { action: 'execute-workflow', config },
});

describe('executeWorkflowHandler', () => {
  it('delegates to runSubWorkflow and returns its items', async () => {
    const runSubWorkflow = vi.fn(async () => ({
      items: [{ json: { ok: true } }], status: 'completed' as const,
    }));
    const ctx = createContext(undefined, () => {}, [], undefined, { runSubWorkflow } as unknown as WorkflowServices);
    const input = [{ json: { seed: 1 } }];
    const out = await executeWorkflowHandler(node({ workflowId: 'wf-1', waitForCompletion: true }), ctx, input);
    expect(runSubWorkflow).toHaveBeenCalledWith({ workflowId: 'wf-1', input, callStack: [] });
    expect(out).toEqual([{ json: { ok: true } }]);
    expect(ctx.logs['x']).toBeUndefined();
  });

  it('forwards the current callStack', async () => {
    const runSubWorkflow = vi.fn(async () => ({ items: [], status: 'completed' as const }));
    const ctx = createContext(
      undefined, () => {}, [], undefined, { runSubWorkflow } as unknown as WorkflowServices,
      undefined, undefined, ['parent-wf'],
    );
    await executeWorkflowHandler(node({ workflowId: 'wf-2' }), ctx, []);
    expect(runSubWorkflow).toHaveBeenCalledWith({ workflowId: 'wf-2', input: [], callStack: ['parent-wf'] });
  });

  it('throws when workflowId is missing', async () => {
    const ctx = createContext(undefined, () => {}, [], undefined, { runSubWorkflow: vi.fn() } as unknown as WorkflowServices);
    await expect(executeWorkflowHandler(node({ workflowId: '  ' }), ctx, [])).rejects.toThrow(/workflowId is required/);
  });

  it('throws when the service is absent', async () => {
    const ctx = createContext(undefined, () => {});
    await expect(executeWorkflowHandler(node({ workflowId: 'wf-1' }), ctx, [])).rejects.toThrow(/requires server services/);
  });

  it('throws when the sub-workflow returns a failed status', async () => {
    const runSubWorkflow = vi.fn(async () => ({ items: [], status: 'failed' as const }));
    const ctx = createContext(undefined, () => {}, [], undefined, { runSubWorkflow } as unknown as WorkflowServices);
    await expect(executeWorkflowHandler(node({ workflowId: 'wf-1' }), ctx, [])).rejects.toThrow(/sub-workflow "wf-1" failed/);
  });

  it('throws the friendly error (not a TypeError) for a non-string workflowId', async () => {
    const ctx = createContext(undefined, () => {}, [], undefined, { runSubWorkflow: vi.fn() } as unknown as WorkflowServices);
    await expect(executeWorkflowHandler(node({ workflowId: 42 as unknown as string }), ctx, [])).rejects.toThrow(/workflowId is required/);
  });

  it('logs a note and still runs when waitForCompletion is false', async () => {
    const runSubWorkflow = vi.fn(async () => ({ items: [], status: 'completed' as const }));
    const events: RunEvent[] = [];
    const ctx = createContext(undefined, (e) => events.push(e), [], undefined, { runSubWorkflow } as unknown as WorkflowServices);
    await executeWorkflowHandler(node({ workflowId: 'wf-1', waitForCompletion: false }), ctx, []);
    expect(runSubWorkflow).toHaveBeenCalledTimes(1);
    expect(ctx.logs['x']?.[0].message).toMatch(/fire-and-forget is not supported/);
    expect(events.some((e) => e.type === 'node:log')).toBe(true);
  });

  it('propagates service errors', async () => {
    const runSubWorkflow = vi.fn(async () => { throw new Error('Execute Workflow: cycle detected: wf-1'); });
    const ctx = createContext(undefined, () => {}, [], undefined, { runSubWorkflow } as unknown as WorkflowServices);
    await expect(executeWorkflowHandler(node({ workflowId: 'wf-1' }), ctx, [])).rejects.toThrow(/cycle detected/);
  });
});
