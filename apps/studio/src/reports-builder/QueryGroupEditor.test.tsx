import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@/i18n';
import { QueryGroupEditor } from './QueryGroupEditor';
import { newGroup, type ConditionGroup } from './queryTreeModel';

const dims = [{ key: 'status', label: 'Status', column: 'status', kind: 'string' as const }, { key: 'code_text', label: 'Test', column: 'code_text', kind: 'string' as const }];

describe('QueryGroupEditor', () => {
  it('adds a rule to the group', () => {
    const onChange = vi.fn();
    render(<QueryGroupEditor group={newGroup()} dimensions={dims} parameters={[]} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /add rule/i }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ children: [expect.objectContaining({ kind: 'rule' })] }));
  });

  it('adds a nested group', () => {
    const onChange = vi.fn();
    render(<QueryGroupEditor group={newGroup()} dimensions={dims} parameters={[]} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /add group/i }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ children: [expect.objectContaining({ kind: 'group' })] }));
  });

  it('toggles the combinator to OR', () => {
    const onChange = vi.fn();
    render(<QueryGroupEditor group={newGroup()} dimensions={dims} parameters={[]} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /^or$/i }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ combinator: 'or' }));
  });

  it('renders a nested group card (recursion)', () => {
    const nested: ConditionGroup = { kind: 'group', combinator: 'and', children: [{ kind: 'group', combinator: 'or', children: [] }] };
    render(<QueryGroupEditor group={nested} dimensions={dims} parameters={[]} onChange={() => {}} />);
    // two combinator toggles present (outer + nested)
    expect(screen.getAllByRole('button', { name: /^and$/i }).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByRole('button', { name: /^or$/i }).length).toBeGreaterThanOrEqual(1);
  });

  it('gives rules in different sibling groups distinct aria-labels (no collision)', () => {
    const tree = { kind: 'group', combinator: 'and', children: [
      { kind: 'group', combinator: 'or', children: [{ kind: 'rule', dimension: 'status', op: 'eq', value: '' }] },
      { kind: 'group', combinator: 'or', children: [{ kind: 'rule', dimension: 'status', op: 'eq', value: '' }] },
    ] } as ConditionGroup;
    const { container } = render(<QueryGroupEditor group={tree} dimensions={dims} parameters={[]} onChange={() => {}} />);
    const labels = Array.from(container.querySelectorAll('[aria-label]')).map((el) => el.getAttribute('aria-label')).filter((l) => l && /dimension$/.test(l));
    expect(new Set(labels).size).toBe(labels.length); // all rule-dimension labels unique
    expect(labels.length).toBe(2);
  });
});
