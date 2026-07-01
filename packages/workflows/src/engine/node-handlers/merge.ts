import type { NodeHandler } from './types';
import type { WorkflowItem } from '../items';

/**
 * Merge items from multiple incoming branches. Uses `ctx.edges` + `ctx.nodeOutputs`
 * to discover all source nodes feeding into this merge node, then combines based on mode.
 */
export const mergeHandler: NodeHandler = async (node, ctx, _input) => {
  const config = (node.data.config as Record<string, unknown>) ?? {};
  const mode = (config.mode as string) ?? 'append';
  const branches: WorkflowItem[][] = ctx.edges
    .filter((e) => e.target === node.id)
    .map((e) => ctx.nodeOutputs[e.source])
    .filter((v): v is WorkflowItem[] => Array.isArray(v));

  switch (mode) {
    case 'combine': {
      const merged: Record<string, unknown> = {};
      for (const items of branches) for (const it of items) Object.assign(merged, it.json);
      return [{ json: merged }];
    }
    case 'chooseBranch': {
      const index = Number(config.preferredBranch ?? 0);
      return branches[index] ?? branches[0] ?? [];
    }
    case 'combineByKey': {
      const joinKeys = (config.joinKeys as string[]) ?? [];
      const joinType = (config.joinType as string) ?? 'left';
      if (joinKeys.length === 0) throw new Error('Merge combineByKey: joinKeys is required');
      const [leftItems = [], ...rest] = branches;
      const rightItems = rest.flat();
      const keyOf = (it: WorkflowItem) => joinKeys.map((k) => String(it.json[k] ?? '')).join(' ');
      const rightIndex = new Map<string, WorkflowItem>();
      for (const r of rightItems) if (!rightIndex.has(keyOf(r))) rightIndex.set(keyOf(r), r);
      const out: WorkflowItem[] = [];
      for (const l of leftItems) {
        const match = rightIndex.get(keyOf(l));
        if (match) out.push({ json: { ...l.json, ...match.json }, ...(l.binary ? { binary: l.binary } : {}) });
        else if (joinType !== 'inner') out.push(l);
      }
      return out;
    }
    case 'append':
    default:
      return branches.flat();
  }
};
