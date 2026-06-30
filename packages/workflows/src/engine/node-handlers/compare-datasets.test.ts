import { describe, it, expect } from 'vitest';
import { compareDatasetsHandler } from './compare-datasets';
import { createContext } from '../execution-context';

function ctxWith(a: unknown[], b: unknown[]) {
  const c = createContext(undefined, () => {}, [
    { id: 'e1', source: 'A', target: 'cd1' },
    { id: 'e2', source: 'B', target: 'cd1' },
  ]);
  c.nodeOutputs['A'] = a as never;
  c.nodeOutputs['B'] = b as never;
  return c;
}
const node = (key: string) => ({ id: 'cd1', type: 'action', data: { action: 'compare-datasets', config: { key } } });

describe('compareDatasetsHandler', () => {
  it('tags removed, added, changed, and same rows by key', async () => {
    const a = [{ json: { id: 1, v: 'x' } }, { json: { id: 2, v: 'y' } }];
    const b = [{ json: { id: 2, v: 'YY' } }, { json: { id: 3, v: 'z' } }];
    const result = await compareDatasetsHandler(node('id'), ctxWith(a, b), []);
    const byId = Object.fromEntries(result.map((r) => [r.json.id, r.json.__status]));
    expect(byId).toEqual({ 1: 'removed', 2: 'changed', 3: 'added' });
  });
  it('tags identical rows as same', async () => {
    const a = [{ json: { id: 1, v: 'x' } }];
    const b = [{ json: { id: 1, v: 'x' } }];
    const result = await compareDatasetsHandler(node('id'), ctxWith(a, b), []);
    expect(result).toEqual([{ json: { id: 1, v: 'x', __status: 'same' } }]);
  });
});
