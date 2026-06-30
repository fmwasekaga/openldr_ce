import type { NodeHandler } from './types';

/** Keep the first (default) or last N items. max <= 0 → passthrough. */
export const limitHandler: NodeHandler = async (node, _ctx, input) => {
  const config = (node.data.config as Record<string, unknown>) ?? {};
  const max = Number(config.maxItems ?? 0);
  if (!Number.isFinite(max) || max <= 0) return input;
  return (config.keep as string) === 'last' ? input.slice(-max) : input.slice(0, max);
};
