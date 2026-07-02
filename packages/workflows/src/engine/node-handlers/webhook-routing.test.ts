import { describe, it, expect } from 'vitest';
import { pickHandler } from './index';
import { createContext } from '../execution-context';
import type { RunnerNode } from './types';

describe('webhook trigger node routing', () => {
  // Regression: a type:'webhook' entry node (what the studio builder + webhook registry produce)
  // must execute as a trigger — emitting the seeded ctx.input (the webhook request envelope) as
  // the run's first items. Before the fix it fell to defaultHandler and emitted [], so the
  // webhook payload never reached downstream nodes (Form Validate saw zero items).
  it('routes a type:"webhook" node to the trigger handler so the payload enters the graph', async () => {
    const node: RunnerNode = { id: 'wh', type: 'webhook', data: { path: 'lab-orders' } };
    const envelope = { method: 'POST', body: { patient: 'Patient/1' }, headers: {}, query: {} };
    const ctx = createContext(envelope, () => {});
    const handler = pickHandler(node);
    const out = await handler(node, ctx, []);
    expect(out).toEqual([{ json: envelope }]);
  });
});
