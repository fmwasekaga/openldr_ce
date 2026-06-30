import { describe, it, expect } from 'vitest';
import { htmlExtractHandler } from './html-extract';
import { createContext } from '../execution-context';

const node = (cfg: Record<string, unknown>) => ({ id: 'he1', type: 'action', data: { action: 'html-extract', config: cfg } });
const ctx = () => createContext(undefined, () => {});
const html = '<div><h1 class="t">Hello</h1><a href="https://x.test">link</a></div>';

describe('htmlExtractHandler', () => {
  it('extracts text by selector', async () => {
    const result = await htmlExtractHandler(node({ sourceField: 'html', extractions: [{ key: 'title', selector: 'h1.t', returnValue: 'text' }] }), ctx(), [{ json: { html } }]);
    expect((result[0].json as Record<string, unknown>).title).toBe('Hello');
  });
  it('extracts an attribute', async () => {
    const result = await htmlExtractHandler(node({ sourceField: 'html', extractions: [{ key: 'href', selector: 'a', returnValue: 'attribute', attribute: 'href' }] }), ctx(), [{ json: { html } }]);
    expect((result[0].json as Record<string, unknown>).href).toBe('https://x.test');
  });
  it('returns empty string when selector matches nothing', async () => {
    const result = await htmlExtractHandler(node({ sourceField: 'html', extractions: [{ key: 'missing', selector: '.nope', returnValue: 'text' }] }), ctx(), [{ json: { html } }]);
    expect((result[0].json as Record<string, unknown>).missing).toBe('');
  });
  it('extracts inner html by selector', async () => {
    const result = await htmlExtractHandler(node({ sourceField: 'html', extractions: [{ key: 'inner', selector: 'h1.t', returnValue: 'html' }] }), ctx(), [{ json: { html } }]);
    expect((result[0].json as Record<string, unknown>).inner).toBe('Hello');
  });
});
