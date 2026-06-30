import { describe, it, expect } from 'vitest';
import { aggregateHandler } from './aggregate';
import { createContext } from '../execution-context';

const node = (field = '', outputField = '') => ({ id: 'ag1', type: 'action', data: { action: 'aggregate', config: { field, outputField } } });
const ctx = () => createContext(undefined, () => {});

describe('aggregateHandler', () => {
  it('collects one field into an array under outputField', async () => {
    const result = await aggregateHandler(node('n', 'all'), ctx(), [{ json: { n: 1 } }, { json: { n: 2 } }]);
    expect(result).toEqual([{ json: { all: [1, 2] } }]);
  });
  it('defaults outputField to the field name', async () => {
    const result = await aggregateHandler(node('n'), ctx(), [{ json: { n: 1 } }]);
    expect(result).toEqual([{ json: { n: [1] } }]);
  });
  it('aggregates whole item json when no field set', async () => {
    const result = await aggregateHandler(node('', 'data'), ctx(), [{ json: { a: 1 } }, { json: { b: 2 } }]);
    expect(result).toEqual([{ json: { data: [{ a: 1 }, { b: 2 }] } }]);
  });
});
