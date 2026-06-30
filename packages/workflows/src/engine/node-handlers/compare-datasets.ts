import type { NodeHandler } from './types';
import type { WorkflowItem } from '../items';

/**
 * Diff two incoming branches by a key field. Branch order follows edge order:
 * the first incoming edge is "A" (old), the second is "B" (new). Each output
 * item is tagged `__status`: removed (A only), added (B only), changed (key in
 * both, json differs), same. With no key, items are concatenated unchanged.
 */
export const compareDatasetsHandler: NodeHandler = async (node, ctx, _input) => {
  const config = (node.data.config as Record<string, unknown>) ?? {};
  const key = (config.key as string) ?? '';
  const branches: WorkflowItem[][] = ctx.edges
    .filter((e) => e.target === node.id)
    .map((e) => ctx.nodeOutputs[e.source])
    .filter((v): v is WorkflowItem[] => Array.isArray(v));
  const a = branches[0] ?? [];
  const b = branches[1] ?? [];
  if (!key) return [...a, ...b];

  const indexBy = (items: WorkflowItem[]) => {
    const m = new Map<string, WorkflowItem>();
    for (const it of items) m.set(String(it.json[key]), it);
    return m;
  };
  const ma = indexBy(a);
  const mb = indexBy(b);
  const out: WorkflowItem[] = [];
  for (const [k, itemA] of ma) {
    const itemB = mb.get(k);
    if (!itemB) out.push({ json: { ...itemA.json, __status: 'removed' } });
    else if (JSON.stringify(itemA.json) !== JSON.stringify(itemB.json)) out.push({ json: { ...itemB.json, __status: 'changed' } });
    else out.push({ json: { ...itemA.json, __status: 'same' } });
  }
  for (const [k, itemB] of mb) {
    if (!ma.has(k)) out.push({ json: { ...itemB.json, __status: 'added' } });
  }
  return out;
};
