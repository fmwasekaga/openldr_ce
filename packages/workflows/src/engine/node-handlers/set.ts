import type { NodeHandler } from './types';
import { resolveTemplate } from '../template';
import type { WorkflowItem } from '../items';

/**
 * Build a new object from user-configured field mappings. Each value supports
 * `{{ $json.foo }}` templates resolved per-item. When `keepExisting` is true, the
 * item's existing json fields survive. Produces one output item per input item.
 */
export const setHandler: NodeHandler = async (node, ctx, input) => {
  const config = (node.data.config as Record<string, unknown>) ?? {};
  const fields = (config.fields as Array<{ name: string; value: string }>) ?? [];
  const keepExisting = Boolean(config.keepExisting);
  const sources: WorkflowItem[] = input.length > 0 ? input : [{ json: {} }];
  return sources.map((item) => {
    const base: Record<string, unknown> = keepExisting ? { ...item.json } : {};
    for (const field of fields) {
      if (!field.name) continue;
      base[field.name] = resolveTemplate(field.value ?? '', ctx, [item]);
    }
    return { json: base };
  });
};
