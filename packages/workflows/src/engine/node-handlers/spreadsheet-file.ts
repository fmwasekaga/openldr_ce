import type { NodeHandler } from './types';
import type { WorkflowItem } from '../items';
import { itemsToCsv, itemsToXlsx, fileToRows } from './file-codecs';

const CONTENT_TYPE: Record<string, string> = {
  csv: 'text/csv',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

/** Read a spreadsheet (xlsx/csv) into items, or write items to a spreadsheet file. */
export const spreadsheetFileHandler: NodeHandler = async (node, ctx, input) => {
  const config = (node.data.config as Record<string, unknown>) ?? {};
  const operation = (config.operation as string) ?? 'read';

  if (operation === 'write') {
    if (!ctx.services?.writeBinary) throw new Error('Spreadsheet File requires server services');
    const format = String(config.format ?? 'xlsx');
    const binaryField = (config.binaryField as string) || 'data';
    const fileName = (config.fileName as string) || `spreadsheet.${format}`;
    const bytes = format === 'csv' ? itemsToCsv(input) : itemsToXlsx(input);
    const ref = await ctx.services.writeBinary({ bytes, fileName, contentType: CONTENT_TYPE[format] ?? 'application/octet-stream' });
    const items = input.length > 0 ? input : [{ json: {} }];
    return items.map((it, i) => (i === 0 ? { ...it, binary: { ...(it.binary ?? {}), [binaryField]: ref } } : it));
  }

  if (!ctx.services?.readBinary) throw new Error('Spreadsheet File requires server services');
  const sourceField = (config.sourceField as string) || 'file';
  const out: WorkflowItem[] = [];
  for (const item of input) {
    const ref = item.binary?.[sourceField];
    if (!ref) throw new Error(`Spreadsheet File: no file on the input item (field '${sourceField}')`);
    const bytes = await ctx.services.readBinary(ref.objectKey);
    for (const row of fileToRows(bytes)) out.push({ json: row });
  }
  return out;
};
