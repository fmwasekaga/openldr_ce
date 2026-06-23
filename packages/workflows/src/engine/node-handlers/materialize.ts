import type { NodeHandler } from './types';

export const materializeHandler: NodeHandler = async (node, ctx, upstream) => {
  if (!ctx.services) throw new Error('Materialize node requires server services');
  const config = (node.data.config as Record<string, unknown>) ?? {};
  const name = String(config.datasetName ?? '').trim();
  if (!name) throw new Error('Materialize node: datasetName is required');
  const up = (upstream ?? {}) as { columns?: { key: string; label: string }[]; rows?: Record<string, unknown>[] };
  const rows = Array.isArray(up.rows) ? up.rows : Array.isArray(upstream) ? (upstream as Record<string, unknown>[]) : [];
  const columns = up.columns ?? [];
  return ctx.services.materializeDataset(name, columns, rows, ctx.workflowId ?? null);
};
