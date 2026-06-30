import vm from 'node:vm';
import type { NodeHandler } from './types';
import { resolveTemplate } from '../template';

interface SwitchRule { name: string; condition: string }

/**
 * Multi-branch router. Evaluates each rule's condition (after `{{ }}` template
 * resolution) in a vm sandbox; the first truthy rule sets the chosen output
 * handle in `ctx.branches[node.id]`. No match → `fallbackOutput`. Items pass
 * through unchanged; the runner prunes the non-chosen outgoing edges.
 */
export const switchHandler: NodeHandler = async (node, ctx, input) => {
  const rules = (node.data.rules as SwitchRule[] | undefined) ?? [];
  const fallback = (node.data.fallbackOutput as string | undefined) ?? 'fallback';
  let branch = fallback;
  for (const rule of rules) {
    const resolved = resolveTemplate(rule.condition ?? '', ctx, input);
    if (!resolved.trim()) continue;
    try {
      const sandbox = { $input: input, $json: input[0]?.json, $items: input.map((i) => i.json), input };
      if (vm.runInNewContext(resolved, sandbox, { timeout: 1000 })) {
        branch = rule.name;
        break;
      }
    } catch (err) {
      throw new Error(`Switch rule "${rule.name}" failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  ctx.branches[node.id] = branch;
  return input;
};
