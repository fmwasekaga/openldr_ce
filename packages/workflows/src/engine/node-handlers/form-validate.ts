import type { NodeHandler } from './types';
import { readPath } from '../template';

/** Coerce an arbitrary value to an answers object; non-objects (or missing paths) become {}. */
function asAnswers(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export const formValidateHandler: NodeHandler = async (node, ctx, input) => {
  if (!ctx.services) throw new Error('Form Validate node requires server services');
  if (!ctx.services.validateForm) throw new Error('Form Validate node: validateForm service not injected');
  const config = (node.data.config as Record<string, unknown>) ?? {};
  const formId = String(config.formId ?? '').trim();
  if (!formId) throw new Error('Form Validate node: formId is required');
  // Optional: read answers from a nested field of each item (e.g. `body` for webhook
  // payloads whose envelope is { method, body, headers, query }). Blank = whole item json.
  const sourcePath = String(config.sourcePath ?? '').trim();
  const items = sourcePath
    ? input.map((item) => ({ json: asAnswers(readPath(item.json, sourcePath)) }))
    : input;
  const result = await ctx.services.validateForm({ formId, items });
  ctx.nodeMeta[node.id] = result.meta;
  return result.items;
};
