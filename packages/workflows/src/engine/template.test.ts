import { describe, it, expect } from 'vitest';
import { resolveTemplate, resolveExpression } from './template';
import { createContext } from './execution-context';
import type { WorkflowItem } from './items';

const items: WorkflowItem[] = [{ json: { name: 'Ada', nested: { n: 1 } } }, { json: { name: 'Bob' } }];
function ctx() {
  const c = createContext(undefined, () => {});
  c.nodeOutputs['up'] = [{ json: { foo: 'bar' } }];
  return c;
}

describe('resolveExpression', () => {
  it('$json reads the first item json', () => {
    expect(resolveExpression('$json.name', ctx(), items)).toBe('Ada');
  });
  it('$items is the array of all jsons', () => {
    expect(resolveExpression('$items', ctx(), items)).toEqual([{ name: 'Ada', nested: { n: 1 } }, { name: 'Bob' }]);
  });
  it('$input is the WorkflowItem[] array', () => {
    expect(resolveExpression('$input', ctx(), items)).toEqual(items);
    expect(resolveExpression('$input.0.json.name', ctx(), items)).toBe('Ada');
  });
  it("$node('id') reads that node's items", () => {
    expect(resolveExpression("$node('up').0.json.foo", ctx(), items)).toBe('bar');
  });
  it('returns raw text for unknown expressions', () => {
    expect(resolveExpression('$unknown.x', ctx(), items)).toBe('{{ $unknown.x }}');
  });
});

describe('resolveTemplate', () => {
  it('substitutes $json fields', () => {
    expect(resolveTemplate('hi {{ $json.name }}', ctx(), items)).toBe('hi Ada');
  });
  it('JSON-stringifies $items', () => {
    expect(resolveTemplate('{{ $items }}', ctx(), items)).toBe(JSON.stringify([{ name: 'Ada', nested: { n: 1 } }, { name: 'Bob' }]));
  });
  it('renders missing paths as empty string', () => {
    expect(resolveTemplate('x{{ $json.nope }}y', ctx(), items)).toBe('xy');
  });
  it('JSON-stringifies non-string values via $json', () => {
    expect(resolveTemplate('{{ $json.nested }}', ctx(), items)).toBe('{"n":1}');
  });
  it('passes through strings with no {{ }}', () => {
    expect(resolveTemplate('hello world', ctx(), items)).toBe('hello world');
  });
});

describe('loop template vars', () => {
  it('resolves $index and $item from the loopVars stack (innermost on top)', () => {
    const ctx = createContext(undefined, () => {});
    ctx.loopVars = [
      { index: 0, item: { name: 'outer' } },
      { index: 3, item: { name: 'inner' } },
    ];
    expect(resolveExpression('$index', ctx, [])).toBe(3);
    expect(resolveExpression('$item.name', ctx, [])).toBe('inner');
  });

  it('returns empty string for $index/$item with no active loop', () => {
    const ctx = createContext(undefined, () => {});
    expect(resolveTemplate('i={{ $index }}', ctx, [])).toBe('i=');
    expect(resolveTemplate('n={{ $item.name }}', ctx, [])).toBe('n=');
  });
});
