import type { NodeHandler } from './types';
import type { WorkflowItem } from '../items';
import { fileToRows } from './file-codecs';

/** Decode an input file (csv|json|text) from binary[sourceField] into items. */
export const extractFromFileHandler: NodeHandler = async (node, ctx, input) => {
  if (!ctx.services?.readBinary) throw new Error('Extract from File requires server services');
  const config = (node.data.config as Record<string, unknown>) ?? {};
  const format = String(config.format ?? 'json');
  const sourceField = (config.sourceField as string) || 'file';
  const outputField = (config.outputField as string) || 'data';

  const out: WorkflowItem[] = [];
  for (const item of input) {
    const ref = item.binary?.[sourceField];
    if (!ref) throw new Error(`Extract from File: no file on the input item (field '${sourceField}')`);
    const bytes = await ctx.services.readBinary(ref.objectKey);
    if (format === 'csv') {
      for (const row of fileToRows(bytes)) out.push({ json: row });
    } else if (format === 'text') {
      out.push({ json: { [outputField]: new TextDecoder().decode(bytes) } });
    } else {
      const parsed = JSON.parse(new TextDecoder().decode(bytes));
      if (Array.isArray(parsed)) {
        for (const r of parsed) out.push({ json: (r && typeof r === 'object' && !Array.isArray(r)) ? r as Record<string, unknown> : { [outputField]: r } });
      } else {
        out.push({ json: (parsed && typeof parsed === 'object') ? parsed as Record<string, unknown> : { [outputField]: parsed } });
      }
    }
  }
  return out;
};
