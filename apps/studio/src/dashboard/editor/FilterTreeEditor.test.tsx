import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { FilterTreeEditor } from './FilterTreeEditor';
import { emptyTree } from './conditionTree.model';
import type { ModelDimension } from '../../api';

const dims: ModelDimension[] = [
  { key: 'status', label: 'Status', column: 'status', kind: 'string' },
  { key: 'priority', label: 'Priority', column: 'priority', kind: 'string' },
];

describe('FilterTreeEditor', () => {
  // Radix Selects aren't jsdom-drivable — behavior is covered by conditionTree.model.test.ts;
  // this is a render smoke-test only.
  it('renders the root group add controls', () => {
    const { getByLabelText } = render(<FilterTreeEditor value={emptyTree()} dimensions={dims} onChange={vi.fn()} />);
    expect(getByLabelText('Add condition')).toBeTruthy();
    expect(getByLabelText('Add group')).toBeTruthy();
  });

  it('renders a row per rule', () => {
    const tree = { kind: 'group' as const, combinator: 'and' as const, children: [
      { kind: 'rule' as const, dimension: 'status', op: 'eq', value: 'F' },
    ] };
    const { getAllByLabelText } = render(<FilterTreeEditor value={tree} dimensions={dims} onChange={vi.fn()} />);
    expect(getAllByLabelText('Filter field').length).toBe(1);
  });
});
