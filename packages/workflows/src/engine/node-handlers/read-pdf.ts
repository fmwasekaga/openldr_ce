/// <reference path="../../pdf-parse.d.ts" />
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import type { NodeHandler } from './types';
import type { WorkflowItem } from '../items';

/** Extract text + page count from a PDF on binary[sourceField]. */
export const readPdfHandler: NodeHandler = async (node, ctx, input) => {
  if (!ctx.services?.readBinary) throw new Error('Read PDF requires server services');
  const config = (node.data.config as Record<string, unknown>) ?? {};
  const sourceField = (config.sourceField as string) || 'file';
  const outputField = (config.outputField as string) || 'text';

  const results: WorkflowItem[] = [];
  for (const item of input) {
    const ref = item.binary?.[sourceField];
    if (!ref) throw new Error(`Read PDF: no file on the input item (field '${sourceField}')`);
    const bytes = await ctx.services.readBinary(ref.objectKey);
    const data = await pdfParse(Buffer.from(bytes));
    results.push({ json: { ...item.json, [outputField]: data.text, numPages: data.numpages } });
  }
  return results;
};
