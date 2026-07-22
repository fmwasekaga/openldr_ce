import { describe, it, expect } from 'vitest';
import { toValue, toLiteral, addCondition, updateCondition, removeCondition, setBound } from './conditionModel';

const dims = [{ key: 'status' }, { key: 'priority' }];

describe('conditionModel', () => {
  it('toValue splits comma-lists for in/between into trimmed arrays', () => {
    expect(toValue('in', 'a, b')).toEqual(['a', 'b']);
    expect(toValue('between', '1,2')).toEqual(['1', '2']);
  });

  it('toValue drops empty entries produced by trailing commas', () => {
    expect(toValue('in', 'a, , b,')).toEqual(['a', 'b']);
  });

  it('toValue keeps other ops as the raw string', () => {
    expect(toValue('eq', 'a, b')).toBe('a, b');
  });

  it('toLiteral joins arrays with ", " and stringifies scalars', () => {
    expect(toLiteral(['a', 'b'])).toBe('a, b');
    expect(toLiteral(null)).toBe('');
    expect(toLiteral(undefined)).toBe('');
    expect(toLiteral(5)).toBe('5');
  });

  it('addCondition appends a default condition for the first dimension', () => {
    expect(addCondition([], dims)).toEqual([{ dimension: 'status', op: 'eq', value: '' }]);
  });

  it('addCondition falls back to an empty dimension key when none exist', () => {
    expect(addCondition([], [])).toEqual([{ dimension: '', op: 'eq', value: '' }]);
  });

  it('updateCondition patches only the targeted row', () => {
    const list = [
      { dimension: 'status', op: 'eq', value: '' },
      { dimension: 'priority', op: 'eq', value: '' },
    ];
    expect(updateCondition(list, 1, { value: 'high' })).toEqual([
      { dimension: 'status', op: 'eq', value: '' },
      { dimension: 'priority', op: 'eq', value: 'high' },
    ]);
  });

  it('removeCondition drops the targeted row', () => {
    const list = [
      { dimension: 'status', op: 'eq', value: '' },
      { dimension: 'priority', op: 'eq', value: '' },
    ];
    expect(removeCondition(list, 0)).toEqual([{ dimension: 'priority', op: 'eq', value: '' }]);
  });

  it('setBound adds a binding for the dimension when given a filter id', () => {
    expect(setBound({}, 'status', 'period')).toEqual({ status: 'period' });
  });

  it('setBound leaves other bindings untouched when adding one', () => {
    expect(setBound({ priority: 'prio' }, 'status', 'period')).toEqual({ priority: 'prio', status: 'period' });
  });

  it('setBound clears the binding for the dimension when given null', () => {
    expect(setBound({ status: 'period', priority: 'prio' }, 'status', null)).toEqual({ priority: 'prio' });
  });

  it('setBound clears the binding for the dimension when given an empty string', () => {
    expect(setBound({ status: 'period' }, 'status', '')).toEqual({});
  });

  it('setBound does not mutate the original bindings object', () => {
    const original = { priority: 'prio' };
    setBound(original, 'status', 'period');
    expect(original).toEqual({ priority: 'prio' });
  });
});
