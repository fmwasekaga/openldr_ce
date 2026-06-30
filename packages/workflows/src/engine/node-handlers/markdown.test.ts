import { describe, it, expect } from 'vitest';
import { markdownHandler } from './markdown';
import { createContext } from '../execution-context';

const node = (cfg: Record<string, unknown>) => ({ id: 'md1', type: 'action', data: { action: 'markdown', config: cfg } });
const ctx = () => createContext(undefined, () => {});

describe('markdownHandler', () => {
  it('converts markdown to html', async () => {
    const result = await markdownHandler(node({ operation: 'markdownToHtml', field: 'md', outputField: 'html' }), ctx(), [{ json: { md: '# Title' } }]);
    expect((result[0].json as Record<string, unknown>).html as string).toContain('<h1');
    expect((result[0].json as Record<string, unknown>).html as string).toContain('Title');
  });
  it('converts html to markdown', async () => {
    const result = await markdownHandler(node({ operation: 'htmlToMarkdown', field: 'html', outputField: 'md' }), ctx(), [{ json: { html: '<h1>Title</h1>' } }]);
    expect((result[0].json as Record<string, unknown>).md as string).toContain('# Title');
  });
  it('returns empty string for empty markdown input', async () => {
    const result = await markdownHandler(node({ operation: 'markdownToHtml', field: 'md', outputField: 'html' }), ctx(), [{ json: { md: '' } }]);
    const html = (result[0].json as Record<string, unknown>).html;
    expect(typeof html).toBe('string');
    expect(html).toBe('');
  });
});
