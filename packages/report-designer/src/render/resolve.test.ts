import { describe, it, expect } from 'vitest';
import { resolveDesignTables } from './resolve';

describe('resolveDesignTables', () => {
  it('resolves bound tables and turns a failing query into an error entry', async () => {
    const runQuery = async (queryId: string) => {
      if (queryId === 'q1') return { columns: [{ key: 'a', label: 'a' }], rows: [{ a: 1 }] };
      throw new Error(`custom query not found: ${queryId}`);
    };
    const design = { parameters: [], pages: [{ id: 'p', elements: [
      { id: 't1', kind: 'table', name: 'T', rect: { x: 0, y: 0, w: 1, h: 1 }, dataSource: { kind: 'custom-query', queryId: 'q1' } },
      { id: 't2', kind: 'table', name: 'T2', rect: { x: 0, y: 0, w: 1, h: 1 }, dataSource: { kind: 'custom-query', queryId: 'missing' } },
      { id: 'txt', kind: 'text', name: 'x', rect: { x: 0, y: 0, w: 1, h: 1 }, text: 'hi' },
    ] }] } as any;
    const resolved = await resolveDesignTables(design, {}, runQuery);
    expect(resolved.get('t1')).toEqual({ columns: [{ key: 'a', label: 'a' }], rows: [{ a: 1 }] });
    expect((resolved.get('t2') as any).error).toContain('missing');
    expect(resolved.has('txt')).toBe(false);
  });
});
