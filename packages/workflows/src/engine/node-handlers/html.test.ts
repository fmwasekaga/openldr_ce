import { describe, it, expect } from 'vitest';
import { htmlHandler } from './html';
import { createContext } from '../execution-context';

const node = (cfg: Record<string, unknown>) => ({ id: 'ht1', type: 'action', data: { action: 'html', config: cfg } });
const ctx = () => createContext(undefined, () => {});

describe('htmlHandler', () => {
  it('strips tags to plain text and collapses whitespace', async () => {
    const result = await htmlHandler(node({ field: 'html', outputField: 'text' }), ctx(), [{ json: { html: '<p>Hello   <b>world</b></p>\n<p>again</p>' } }]);
    expect((result[0].json as Record<string, unknown>).text).toBe('Hello world again');
  });
  it('returns empty string for empty input', async () => {
    const result = await htmlHandler(node({ field: 'html', outputField: 'text' }), ctx(), [{ json: { html: '' } }]);
    expect((result[0].json as Record<string, unknown>).text).toBe('');
  });
});
