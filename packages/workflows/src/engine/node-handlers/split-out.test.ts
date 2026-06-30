import { describe, it, expect } from 'vitest';
import { splitOutHandler } from './split-out';
import { createContext } from '../execution-context';

const node = (field: string) => ({ id: 'sp1', type: 'action', data: { action: 'split-out', config: { field } } });
const ctx = () => createContext(undefined, () => {});

describe('splitOutHandler', () => {
  it('splits an array of objects into one item each', async () => {
    const result = await splitOutHandler(node('rows'), ctx(), [{ json: { rows: [{ a: 1 }, { a: 2 }] } }]);
    expect(result).toEqual([{ json: { a: 1 } }, { json: { a: 2 } }]);
  });
  it('wraps primitive array elements under `value`', async () => {
    const result = await splitOutHandler(node('tags'), ctx(), [{ json: { tags: ['x', 'y'] } }]);
    expect(result).toEqual([{ json: { value: 'x' } }, { json: { value: 'y' } }]);
  });
  it('passes through items whose field is not an array', async () => {
    const result = await splitOutHandler(node('rows'), ctx(), [{ json: { rows: 5 } }]);
    expect(result).toEqual([{ json: { rows: 5 } }]);
  });
});
