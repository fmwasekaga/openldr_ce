import { describe, it, expect } from 'vitest';
import { removeDuplicatesHandler } from './remove-duplicates';
import { createContext } from '../execution-context';

const node = (field = '') => ({ id: 'rd1', type: 'action', data: { action: 'remove-duplicates', config: { field } } });
const ctx = () => createContext(undefined, () => {});

describe('removeDuplicatesHandler', () => {
  it('dedupes by a field, keeping first occurrence', async () => {
    const result = await removeDuplicatesHandler(node('id'), ctx(), [
      { json: { id: 1, v: 'a' } }, { json: { id: 1, v: 'b' } }, { json: { id: 2, v: 'c' } },
    ]);
    expect(result).toEqual([{ json: { id: 1, v: 'a' } }, { json: { id: 2, v: 'c' } }]);
  });
  it('dedupes by whole item when no field set', async () => {
    const result = await removeDuplicatesHandler(node(), ctx(), [
      { json: { a: 1 } }, { json: { a: 1 } }, { json: { a: 2 } },
    ]);
    expect(result).toEqual([{ json: { a: 1 } }, { json: { a: 2 } }]);
  });
});
