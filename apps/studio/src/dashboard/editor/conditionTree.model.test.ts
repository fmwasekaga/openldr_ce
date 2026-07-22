import { describe, it, expect } from 'vitest';
import {
  emptyTree, filtersToTree, hasRules, addRule, addGroup, updateRule, removeAt, setCombinator, bindFilterTree,
} from './conditionTree.model';

const dims = [{ key: 'status' }, { key: 'priority' }];

describe('conditionTree.model', () => {
  it('emptyTree is an AND group with no children', () => {
    expect(emptyTree()).toEqual({ kind: 'group', combinator: 'and', children: [] });
  });

  it('filtersToTree wraps flat filters in a root AND group', () => {
    expect(filtersToTree([{ dimension: 'status', op: 'eq', value: 'F' }])).toEqual({
      kind: 'group', combinator: 'and',
      children: [{ kind: 'rule', dimension: 'status', op: 'eq', value: 'F' }],
    });
  });

  it('hasRules is false for an empty/all-group tree and true once a rule exists', () => {
    expect(hasRules(emptyTree())).toBe(false);
    expect(hasRules(filtersToTree([{ dimension: 'status', op: 'eq', value: 'F' }]))).toBe(true);
  });

  it('addRule appends a default rule to the addressed group', () => {
    expect(addRule(emptyTree(), [], dims)).toEqual({
      kind: 'group', combinator: 'and',
      children: [{ kind: 'rule', dimension: 'status', op: 'eq', value: '' }],
    });
  });

  it('addGroup appends a nested OR group', () => {
    const t = addGroup(emptyTree(), []);
    expect(t.children[0]).toEqual({ kind: 'group', combinator: 'or', children: [] });
  });

  it('updateRule patches the rule at a nested path', () => {
    let t = addRule(emptyTree(), [], dims);       // root.children[0] = rule
    t = addGroup(t, []);                           // root.children[1] = group
    t = addRule(t, [1], dims);                     // root.children[1].children[0] = rule
    t = updateRule(t, [1, 0], { value: 'high', dimension: 'priority' });
    expect((t.children[1] as any).children[0]).toEqual({ kind: 'rule', dimension: 'priority', op: 'eq', value: 'high' });
  });

  it('removeAt drops the addressed node', () => {
    let t = addRule(emptyTree(), [], dims);
    t = addRule(t, [], dims);
    t = removeAt(t, [0]);
    expect(t.children.length).toBe(1);
  });

  it('setCombinator flips a group between and/or', () => {
    expect(setCombinator(emptyTree(), [], 'or').combinator).toBe('or');
  });

  it('bindFilterTree ANDs a scalar binding value and prunes the bound dimension', () => {
    const tree = filtersToTree([
      { dimension: 'status', op: 'eq', value: 'F' },
      { dimension: 'priority', op: 'eq', value: '' }, // stale literal for a bound row
    ]);
    const out = bindFilterTree(tree, { priority: 'prio' }, { prio: 'stat' });
    expect(out).toEqual({
      kind: 'group', combinator: 'and',
      children: [
        { kind: 'group', combinator: 'and', children: [{ kind: 'rule', dimension: 'status', op: 'eq', value: 'F' }] },
        { kind: 'rule', dimension: 'priority', op: 'eq', value: 'stat' },
      ],
    });
  });

  it('bindFilterTree expands a date-range binding into gte + lte', () => {
    const out = bindFilterTree(emptyTree(), { authored_on: 'period' }, { period: { from: '2024-01-01', to: '2024-03-31' } });
    expect(out.children).toEqual([
      { kind: 'rule', dimension: 'authored_on', op: 'gte', value: '2024-01-01' },
      { kind: 'rule', dimension: 'authored_on', op: 'lte', value: '2024-03-31' },
    ]);
  });

  it('bindFilterTree returns the pruned tree unchanged when no binding has a value', () => {
    const tree = filtersToTree([{ dimension: 'status', op: 'eq', value: 'F' }]);
    expect(bindFilterTree(tree, { priority: 'prio' }, {})).toEqual(tree);
  });
});
