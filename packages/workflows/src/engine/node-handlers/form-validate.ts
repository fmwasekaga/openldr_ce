import type { NodeHandler } from './types';

export const formValidateHandler: NodeHandler = async (node, ctx, input) => {
  if (!ctx.services) throw new Error('Form Validate node requires server services');
  if (!ctx.services.validateForm) throw new Error('Form Validate node: validateForm service not injected');
  const config = (node.data.config as Record<string, unknown>) ?? {};
  const formId = String(config.formId ?? '').trim();
  if (!formId) throw new Error('Form Validate node: formId is required');
  const result = await ctx.services.validateForm({ formId, items: input });
  ctx.nodeMeta[node.id] = result.meta;
  return result.items;
};
