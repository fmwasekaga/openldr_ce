import type { NodeHandler } from './types';
import { itemsToCsv, itemsToXlsx } from './file-codecs';

const CONTENT_TYPE: Record<string, string> = {
  csv: 'text/csv',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  json: 'application/json',
  text: 'text/plain',
};

/** Encode the input items into a single file attached to the first output item's binary lane. */
export const convertToFileHandler: NodeHandler = async (node, ctx, input) => {
  if (!ctx.services?.writeBinary) throw new Error('Convert to File requires server services');
  const config = (node.data.config as Record<string, unknown>) ?? {};
  const format = String(config.format ?? 'json');
  const binaryField = (config.binaryField as string) || 'data';
  const fileName = (config.fileName as string) || `data.${format === 'text' ? 'txt' : format}`;
  const textField = (config.textField as string) || '';

  let bytes: Uint8Array;
  if (format === 'csv') bytes = itemsToCsv(input);
  else if (format === 'xlsx') bytes = itemsToXlsx(input);
  else if (format === 'text') {
    const text = input.map((i) => String(textField ? i.json[textField] ?? '' : JSON.stringify(i.json))).join('\n');
    bytes = new TextEncoder().encode(text);
  } else {
    bytes = new TextEncoder().encode(JSON.stringify(input.map((i) => i.json)));
  }

  const ref = await ctx.services.writeBinary({ bytes, fileName, contentType: CONTENT_TYPE[format] ?? 'application/octet-stream' });
  const items = input.length > 0 ? input : [{ json: {} }];
  return items.map((it, i) => (i === 0 ? { ...it, binary: { ...(it.binary ?? {}), [binaryField]: ref } } : it));
};
