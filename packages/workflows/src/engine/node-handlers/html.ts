import * as cheerio from 'cheerio';
import type { NodeHandler } from './types';

/** Convert HTML to plain text: strip tags, collapse runs of whitespace, trim. */
export const htmlHandler: NodeHandler = async (node, _ctx, input) => {
  const config = (node.data.config as Record<string, unknown>) ?? {};
  const field = (config.field as string) || 'html';
  const outputField = (config.outputField as string) || 'text';

  return input.map((item) => {
    const $ = cheerio.load(String(item.json[field] ?? ''));
    const text = $.root().text().replace(/\s+/g, ' ').trim();
    return { json: { ...item.json, [outputField]: text } };
  });
};
