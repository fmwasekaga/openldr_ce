import { marked } from 'marked';
import TurndownService from 'turndown';
import type { NodeHandler } from './types';

const turndown = new TurndownService({ headingStyle: 'atx' });

/** Convert Markdown↔HTML. */
export const markdownHandler: NodeHandler = async (node, _ctx, input) => {
  const config = (node.data.config as Record<string, unknown>) ?? {};
  const operation = (config.operation as string) ?? 'markdownToHtml';
  const field = (config.field as string) || (operation === 'markdownToHtml' ? 'md' : 'html');
  const outputField = (config.outputField as string) || (operation === 'markdownToHtml' ? 'html' : 'md');

  return input.map((item) => {
    const value = String(item.json[field] ?? '');
    const converted = operation === 'htmlToMarkdown'
      ? turndown.turndown(value)
      : marked.parse(value, { async: false });
    return { json: { ...item.json, [outputField]: converted } };
  });
};
