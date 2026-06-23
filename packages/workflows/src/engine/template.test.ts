import { describe, it, expect } from 'vitest';
import { resolveTemplate, resolveExpression } from './template';
import { createContext } from './execution-context';

const ctx = () => {
  const c = createContext(undefined, () => {});
  c.nodeOutputs['n1'] = { name: 'alice', nested: { v: 7 } };
  return c;
};

describe('template resolver', () => {
  it('resolves $input dot-paths', () => {
    expect(resolveTemplate('hi {{ $input.name }}', ctx(), { name: 'bob' })).toBe('hi bob');
  });
  it('resolves $node() references', () => {
    expect(resolveExpression("$node('n1').nested.v", ctx(), undefined)).toBe(7);
  });
  it('renders missing paths as empty string', () => {
    expect(resolveTemplate('x{{ $input.nope }}y', ctx(), {})).toBe('xy');
  });
  it('JSON-stringifies non-string values', () => {
    expect(resolveTemplate('{{ $input.o }}', ctx(), { o: { a: 1 } })).toBe('{"a":1}');
  });
});
