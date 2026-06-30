import type { NodeHandler } from './types';

/** Order items by a single json field. Nullish values sort first (asc). */
export const sortHandler: NodeHandler = async (node, _ctx, input) => {
  const config = (node.data.config as Record<string, unknown>) ?? {};
  const field = (config.field as string) ?? '';
  const desc = (config.order as string) === 'desc';
  if (!field) return input;
  const sorted = [...input].sort((a, b) => {
    const av = a.json[field] as unknown;
    const bv = b.json[field] as unknown;
    if (av == null && bv == null) return 0;
    if (av == null) return -1;
    if (bv == null) return 1;
    if (av < bv) return -1;
    if (av > bv) return 1;
    return 0;
  });
  return desc ? sorted.reverse() : sorted;
};
