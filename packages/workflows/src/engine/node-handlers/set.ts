import type { NodeHandler } from './types';
import { resolveTemplate } from '../template';

/**
 * Build a new object from user-configured field mappings. Each value supports
 * `{{ $input.foo }}` templates. When `keepExisting` is true, the upstream
 * object is spread first so unmapped fields survive.
 */
export const setHandler: NodeHandler = async (node, ctx, upstream) => {
  const config = (node.data.config as Record<string, unknown>) ?? {};
  const fields = (config.fields as Array<{ name: string; value: string }>) ?? [];
  const keepExisting = Boolean(config.keepExisting);

  const base: Record<string, unknown> = keepExisting && upstream && typeof upstream === 'object'
    ? { ...(upstream as Record<string, unknown>) }
    : {};

  for (const field of fields) {
    if (!field.name) continue;
    base[field.name] = resolveTemplate(field.value ?? '', ctx, upstream);
  }

  return base;
};
