import type { NodeHandler } from './types';

export const exportHandler: NodeHandler = async (node, ctx, upstream) => {
  if (!ctx.services) throw new Error('Export node requires server services');
  const config = (node.data.config as Record<string, unknown>) ?? {};
  const format = String(config.format ?? 'csv') as 'csv' | 'xlsx' | 'pdf';
  const up = (upstream ?? {}) as { columns?: { key: string; label: string }[]; rows?: Record<string, unknown>[] };
  const rows = Array.isArray(up.rows) ? up.rows : Array.isArray(upstream) ? (upstream as Record<string, unknown>[]) : [];
  const columns = up.columns ?? (rows[0] ? Object.keys(rows[0]).map((k) => ({ key: k, label: k })) : []);
  return ctx.services.exportArtifact({
    format,
    filename: config.filename as string | undefined,
    title: (node.data.label as string) ?? 'Workflow Export',
    columns,
    rows,
  });
};
