import type { NodeHandler } from './types';
import { fromItems } from '../items';

const CONTENT_TYPE: Record<string, string> = {
  csv: 'text/csv',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
};

export const exportHandler: NodeHandler = async (node, ctx, input) => {
  if (!ctx.services) throw new Error('Export node requires server services');
  const config = (node.data.config as Record<string, unknown>) ?? {};
  const format = String(config.format ?? 'csv') as 'csv' | 'xlsx' | 'pdf';
  const { columns, rows } = fromItems(input);
  const result = await ctx.services.exportArtifact({
    format,
    filename: config.filename as string | undefined,
    title: (node.data.label as string) ?? 'Workflow Export',
    columns,
    rows,
  });
  const ref = {
    objectKey: result.objectKey,
    contentType: CONTENT_TYPE[result.format] ?? 'application/octet-stream',
    fileName: (config.filename as string | undefined) ?? `export.${result.format}`,
    byteSize: result.byteSize,
  };
  const items = input.length > 0 ? input : [{ json: {} }];
  return items.map((it, i) => (i === 0 ? { ...it, binary: { ...(it.binary ?? {}), export: ref } } : it));
};
