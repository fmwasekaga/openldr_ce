import { describe, it, expect } from 'vitest';
import { newRule, newGroup, seedTreeFromFilters, isFlatRepresentable, flattenToFilters, type ConditionGroup } from './queryTreeModel';

const dims = [{ key: 'status', label: 'Status', column: 'status', kind: 'string' as const }];

describe('queryTreeModel', () => {
  it('newRule uses the first dimension and eq/empty defaults', () => {
    expect(newRule(dims)).toEqual({ kind: 'rule', dimension: 'status', op: 'eq', value: '' });
  });
  it('newGroup is an empty AND group', () => {
    expect(newGroup()).toEqual({ kind: 'group', combinator: 'and', children: [] });
  });
  it('seedTreeFromFilters wraps flat filters in one AND group of rules', () => {
    const t = seedTreeFromFilters([{ dimension: 'status', op: 'eq', value: 'completed' }]);
    expect(t).toEqual({ kind: 'group', combinator: 'and', children: [{ kind: 'rule', dimension: 'status', op: 'eq', value: 'completed' }] });
  });
  it('isFlatRepresentable: AND group of only rules → true; OR or nested → false', () => {
    const flat: ConditionGroup = { kind: 'group', combinator: 'and', children: [{ kind: 'rule', dimension: 'status', op: 'eq', value: 'x' }] };
    const or: ConditionGroup = { kind: 'group', combinator: 'or', children: [{ kind: 'rule', dimension: 'status', op: 'eq', value: 'x' }] };
    const nested: ConditionGroup = { kind: 'group', combinator: 'and', children: [{ kind: 'group', combinator: 'and', children: [] }] };
    expect(isFlatRepresentable(flat)).toBe(true);
    expect(isFlatRepresentable(or)).toBe(false);
    expect(isFlatRepresentable(nested)).toBe(false);
  });
  it('flattenToFilters drops the kind discriminant back to flat filters', () => {
    const flat: ConditionGroup = { kind: 'group', combinator: 'and', children: [{ kind: 'rule', dimension: 'status', op: 'eq', value: 'completed' }] };
    expect(flattenToFilters(flat)).toEqual([{ dimension: 'status', op: 'eq', value: 'completed' }]);
  });
});
