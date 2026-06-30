import * as cheerio from 'cheerio';
import type { NodeHandler } from './types';

interface Extraction {
  key: string;
  selector: string;
  returnValue?: 'text' | 'html' | 'attribute';
  attribute?: string;
}

/** Extract values from an HTML field using CSS-selector rules. Each rule writes `key` onto the item. */
export const htmlExtractHandler: NodeHandler = async (node, _ctx, input) => {
  const config = (node.data.config as Record<string, unknown>) ?? {};
  const sourceField = (config.sourceField as string) || 'html';
  const extractions = (config.extractions as Extraction[] | undefined) ?? [];

  return input.map((item) => {
    const $ = cheerio.load(String(item.json[sourceField] ?? ''));
    const extracted: Record<string, unknown> = {};
    for (const rule of extractions) {
      if (!rule.key || !rule.selector) continue;
      const el = $(rule.selector);
      if (rule.returnValue === 'html') extracted[rule.key] = el.html() ?? '';
      else if (rule.returnValue === 'attribute') extracted[rule.key] = el.attr(rule.attribute ?? '') ?? '';
      else extracted[rule.key] = el.text().trim();
    }
    return { json: { ...item.json, ...extracted } };
  });
};
