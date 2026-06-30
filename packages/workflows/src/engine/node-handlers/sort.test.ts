import { describe, it, expect } from 'vitest';
import { sortHandler } from './sort';
import { createContext } from '../execution-context';

const node = (field: string, order = 'asc') => ({ id: 'so1', type: 'action', data: { action: 'sort', config: { field, order } } });
const ctx = () => createContext(undefined, () => {});

describe('sortHandler', () => {
  it('sorts ascending by field', async () => {
    const result = await sortHandler(node('n'), ctx(), [{ json: { n: 3 } }, { json: { n: 1 } }, { json: { n: 2 } }]);
    expect(result.map((i) => i.json.n)).toEqual([1, 2, 3]);
  });
  it('sorts descending by field', async () => {
    const result = await sortHandler(node('n', 'desc'), ctx(), [{ json: { n: 1 } }, { json: { n: 3 } }, { json: { n: 2 } }]);
    expect(result.map((i) => i.json.n)).toEqual([3, 2, 1]);
  });
  it('returns input unchanged when no field is set', async () => {
    const input = [{ json: { n: 2 } }, { json: { n: 1 } }];
    const result = await sortHandler(node(''), ctx(), input);
    expect(result).toEqual(input);
  });
});
