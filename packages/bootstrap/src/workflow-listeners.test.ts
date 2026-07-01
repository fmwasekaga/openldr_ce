import { describe, it, expect, vi } from 'vitest';
import { createWorkflowListenerManager, extractListenerSpecs, type ListenerDriver } from './workflow-listeners';

const wf = (id: string, enabled: boolean, nodes: unknown[]) => ({ id, enabled, definition: { nodes, edges: [] } });
const pgNode = (nodeId: string, connectorId = 'c1', channel = 'ch') =>
  ({ id: nodeId, type: 'trigger', data: { triggerType: 'postgres', config: { connectorId, channel } } });

function fakeDriver() {
  const stops: string[] = [];
  const starts: string[] = [];
  const driver: ListenerDriver = {
    async start(spec, _onFire) {
      starts.push(`${spec.workflowId}:${spec.nodeId}`);
      return { stop: async () => { stops.push(`${spec.workflowId}:${spec.nodeId}`); } };
    },
  };
  return { driver, starts, stops };
}

describe('extractListenerSpecs', () => {
  it('collects postgres/email trigger nodes from enabled workflows only', () => {
    const specs = extractListenerSpecs([
      wf('w1', true, [pgNode('n1'), { id: 'x', type: 'action', data: {} }]),
      wf('w2', false, [pgNode('n2')]),
      wf('w3', true, [{ id: 'e1', type: 'trigger', data: { triggerType: 'email', config: { connectorId: 'c2' } } }]),
    ]);
    expect(specs.map((s) => `${s.workflowId}:${s.nodeId}:${s.triggerType}`).sort())
      .toEqual(['w1:n1:postgres', 'w3:e1:email']);
  });
});

describe('listener manager sync', () => {
  const deps = (driver: ListenerDriver, list: unknown[]) => ({
    store: { list: vi.fn(async () => list) },
    runAndRecord: vi.fn(async () => {}),
    logger: { error: vi.fn(), warn: vi.fn() },
    cfg: { WORKFLOW_LISTENERS_ENABLED: true },
    drivers: { postgres: driver, email: driver },
  });

  it('starts a listener per spec on reconcile', async () => {
    const { driver, starts } = fakeDriver();
    const m = createWorkflowListenerManager(deps(driver, [wf('w1', true, [pgNode('n1')])]) as never);
    await m.reconcile();
    expect(starts).toEqual(['w1:n1']);
  });

  it('stops removed and restarts changed listeners on re-reconcile', async () => {
    const { driver, starts, stops } = fakeDriver();
    const store = { list: vi.fn() };
    const d = deps(driver, []) as never;
    (d as { store: unknown }).store = store;
    const m = createWorkflowListenerManager(d);
    store.list.mockResolvedValueOnce([wf('w1', true, [pgNode('n1', 'c1', 'chA')])]);
    await m.reconcile();
    store.list.mockResolvedValueOnce([wf('w1', true, [pgNode('n1', 'c1', 'chB')])]);
    await m.reconcile();
    expect(starts).toEqual(['w1:n1', 'w1:n1']);
    expect(stops).toEqual(['w1:n1']);
  });

  it('master switch off → no listeners', async () => {
    const { driver, starts } = fakeDriver();
    const d = deps(driver, [wf('w1', true, [pgNode('n1')])]) as never;
    (d as { cfg: { WORKFLOW_LISTENERS_ENABLED: boolean } }).cfg.WORKFLOW_LISTENERS_ENABLED = false;
    const m = createWorkflowListenerManager(d);
    await m.reconcile();
    expect(starts).toEqual([]);
  });

  it('a driver start failure is logged and skipped (no throw)', async () => {
    const bad: ListenerDriver = { async start() { throw new Error('bad connector'); } };
    const d = deps(bad, [wf('w1', true, [pgNode('n1')])]) as never;
    const m = createWorkflowListenerManager(d);
    await expect(m.reconcile()).resolves.toBeUndefined();
    expect((d as { logger: { error: ReturnType<typeof vi.fn> } }).logger.error).toHaveBeenCalled();
  });

  it('stopAll stops every active listener', async () => {
    const { driver, stops } = fakeDriver();
    const m = createWorkflowListenerManager(deps(driver, [wf('w1', true, [pgNode('n1')])]) as never);
    await m.reconcile();
    await m.stopAll();
    expect(stops).toEqual(['w1:n1']);
  });
});
