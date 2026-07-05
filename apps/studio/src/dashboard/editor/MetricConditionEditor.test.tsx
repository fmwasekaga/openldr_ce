import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import { MetricConditionEditor } from './MetricConditionEditor';

const dims = [
  { key: 'interpretation_code', label: 'Interpretation', column: 'interpretation_code', kind: 'string' as const },
  { key: 'status', label: 'Status', column: 'status', kind: 'string' as const },
];

describe('MetricConditionEditor', () => {
  it('adds a condition defaulting to the first dimension', () => {
    const onChange = vi.fn();
    render(<MetricConditionEditor conditions={[]} dimensions={dims} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /add condition/i }));
    expect(onChange).toHaveBeenCalledWith([{ dimension: 'interpretation_code', op: 'eq', value: '' }]);
  });

  it('edits a condition value', () => {
    const onChange = vi.fn();
    render(<MetricConditionEditor conditions={[{ dimension: 'interpretation_code', op: 'eq', value: '' }]} dimensions={dims} onChange={onChange} />);
    fireEvent.change(screen.getByDisplayValue(''), { target: { value: 'R' } });
    expect(onChange).toHaveBeenCalledWith([{ dimension: 'interpretation_code', op: 'eq', value: 'R' }]);
  });

  it('removes a condition', () => {
    const onChange = vi.fn();
    render(<MetricConditionEditor conditions={[{ dimension: 'status', op: 'eq', value: 'final' }]} dimensions={dims} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /remove condition/i }));
    expect(onChange).toHaveBeenCalledWith([]);
  });
});
