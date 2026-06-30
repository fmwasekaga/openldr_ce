import { describe, it, expect } from 'vitest';
import { xmlHandler } from './xml';
import { createContext } from '../execution-context';

const node = (cfg: Record<string, unknown>) => ({ id: 'xm1', type: 'action', data: { action: 'xml', config: cfg } });
const ctx = () => createContext(undefined, () => {});

describe('xmlHandler', () => {
  it('parses XML into a JSON object', async () => {
    const result = await xmlHandler(node({ operation: 'parse', field: 'xml', outputField: 'data' }), ctx(), [{ json: { xml: '<root><a>1</a><b>two</b></root>' } }]);
    const data = (result[0].json as Record<string, unknown>).data as Record<string, unknown>;
    expect((data.root as Record<string, unknown>).a).toBe(1);
    expect((data.root as Record<string, unknown>).b).toBe('two');
  });
  it('builds XML from a JSON object', async () => {
    const result = await xmlHandler(node({ operation: 'build', field: 'obj', outputField: 'xml' }), ctx(), [{ json: { obj: { root: { a: 1 } } } }]);
    expect((result[0].json as Record<string, unknown>).xml).toContain('<root>');
    expect((result[0].json as Record<string, unknown>).xml).toContain('<a>1</a>');
  });
});
