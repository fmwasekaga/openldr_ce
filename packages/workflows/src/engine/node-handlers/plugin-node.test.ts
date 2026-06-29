import { describe, it, expect, vi } from 'vitest';
import { pluginNodeHandler } from './plugin-node';
import { createContext } from '../execution-context';
import type { RunnerNode } from './types';
import type { WorkflowItem } from '../items';

function ctxWith(runPluginNode?: ReturnType<typeof vi.fn>) {
  const ctx = createContext(undefined, () => {});
  ctx.services = runPluginNode ? ({ runPluginNode } as never) : undefined;
  return ctx;
}
const node = (data: Record<string, unknown>): RunnerNode => ({ id: 'n1', type: 'plugin-node', data });

describe('pluginNodeHandler', () => {
  it('forwards pluginId/nodeId/config and input items for a transform node', async () => {
    const run = vi.fn().mockResolvedValue({ items: [{ json: { ok: true } }] });
    const ctx = ctxWith(run);
    const input: WorkflowItem[] = [{ json: { a: 1 } }];
    const out = await pluginNodeHandler(node({ pluginId: 'p', nodeId: 'echo', kind: 'transform', config: { note: 'x' } }), ctx, input);
    expect(run).toHaveBeenCalledWith({ pluginId: 'p', nodeId: 'echo', config: { note: 'x' }, items: input });
    expect(out).toEqual([{ json: { ok: true } }]);
  });

  it('passes items:[] for a source node (ignores input)', async () => {
    const run = vi.fn().mockResolvedValue({ items: [] });
    const ctx = ctxWith(run);
    const input: WorkflowItem[] = [{ json: { a: 1 } }];
    await pluginNodeHandler(node({ pluginId: 'p', nodeId: 'src', kind: 'source', config: {} }), ctx, input);
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ items: [] }));
  });

  it('emits a node:log for non-empty meta', async () => {
    const emit = vi.fn();
    const run = vi.fn().mockResolvedValue({ items: [{ json: { ok: true } }], meta: { count: 1 } });
    const ctx = createContext(undefined, emit);
    ctx.services = { runPluginNode: run } as never;
    await pluginNodeHandler(node({ pluginId: 'p', nodeId: 'echo', kind: 'transform' }), ctx, []);
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({ type: 'node:log' }));
  });

  it('returns result.items', async () => {
    const run = vi.fn().mockResolvedValue({ items: [{ json: { ok: true } }], meta: { count: 1 } });
    const ctx = ctxWith(run);
    const out = await pluginNodeHandler(node({ pluginId: 'p', nodeId: 'echo' }), ctx, []);
    expect(out).toEqual([{ json: { ok: true } }]);
  });

  it('throws when the service is not available', async () => {
    const ctx = ctxWith(undefined);
    await expect(pluginNodeHandler(node({ pluginId: 'p', nodeId: 'echo' }), ctx, []))
      .rejects.toThrow(/not available/i);
  });

  it('throws when pluginId or nodeId is missing', async () => {
    const ctx = ctxWith(vi.fn());
    await expect(pluginNodeHandler(node({ pluginId: 'p' }), ctx, [])).rejects.toThrow(/required/i);
  });
});
