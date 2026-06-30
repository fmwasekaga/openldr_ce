import * as cheerio from 'cheerio';
import type { NodeHandler } from './types';

interface Extraction {
  key: string;
  selector: string;
  returnValue?: 'text' | 'html' | 'attribute';
  attribute?: string;
}

/** Extract values from an HTML field using CSS-selector rules. Each rule writes `key` onto the item.
 *  When a selector matches multiple elements, `text` concatenates all matches while `html`/`attribute`
 *  use the first match (mirrors n8n). An invalid selector yields `null` for that key. */
export const htmlExtractHandler: NodeHandler = async (node, _ctx, input) => {
  const config = (node.data.config as Record<string, unknown>) ?? {};
  const sourceField = (config.sourceField as string) || 'html';
  const extractions = (config.extractions as Extraction[] | undefined) ?? [];

  return input.map((item) => {
    const $ = cheerio.load(String(item.json[sourceField] ?? ''));
    const extracted: Record<string, unknown> = {};
    for (const rule of extractions) {
      if (!rule.key || !rule.selector) continue;
      try {
        const el = $(rule.selector);
        if (rule.returnValue === 'html') extracted[rule.key] = el.html() ?? '';
        else if (rule.returnValue === 'attribute') extracted[rule.key] = el.attr(rule.attribute ?? '') ?? '';
        else extracted[rule.key] = el.text().trim();
      } catch {
        extracted[rule.key] = null;
      }
    }
    return { json: { ...item.json, ...extracted } };
  });
};
