import { describe, it, expect, vi } from 'vitest';
import { logHandler } from './log';
import { createContext } from '../execution-context';
import type { RunnerNode } from './types';
import type { WorkflowItem } from '../items';

const node = (data: Record<string, unknown>): RunnerNode => ({ id: 'log-1', type: 'action', data });

describe('logHandler', () => {
  it('resolves $json template and emits a node:log event', async () => {
    const emit = vi.fn();
    const ctx = createContext(undefined, emit);
    const input: WorkflowItem[] = [{ json: { body: { name: 'x' } } }];
    const out = await logHandler(node({ message: 'hello {{ $json.body.name }}', level: 'info' }), ctx, input);
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({
      type: 'node:log',
      entry: expect.objectContaining({ message: 'hello x', level: 'info', nodeId: 'log-1' }),
    }));
    // passthrough — returns input unchanged
    expect(out).toBe(input);
  });

  it('captures the entry in ctx.logs', async () => {
    const ctx = createContext(undefined, () => {});
    const input: WorkflowItem[] = [{ json: { v: 42 } }];
    await logHandler(node({ message: 'val={{ $json.v }}' }), ctx, input);
    expect(ctx.logs['log-1']).toHaveLength(1);
    expect(ctx.logs['log-1'][0].message).toBe('val=42');
  });

  it('defaults level to "log"', async () => {
    const emit = vi.fn();
    const ctx = createContext(undefined, emit);
    const input: WorkflowItem[] = [{ json: {} }];
    await logHandler(node({ message: 'hi' }), ctx, input);
    expect(emit.mock.calls[0][0].entry.level).toBe('log');
  });

  it('returns input items unchanged', async () => {
    const ctx = createContext(undefined, () => {});
    const input: WorkflowItem[] = [{ json: { a: 1 } }, { json: { b: 2 } }];
    const out = await logHandler(node({ message: 'test' }), ctx, input);
    expect(out).toBe(input);
  });
});
