import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FilterListEditor, type BuilderFilter } from './FilterListEditor';
import type { ModelDimension } from '../api';
import type { ReportParam } from '@openldr/report-builder/pure';

const DIMS: ModelDimension[] = [
  { key: 'status', label: 'Status', column: 'status', kind: 'string' },
  { key: 'authored_on', label: 'Authored', column: 'authored_on', kind: 'date' },
];
const PARAMS: ReportParam[] = [{ id: 'site', label: 'Site', type: 'select', required: false }];

describe('FilterListEditor', () => {
  it('adds a filter with the first dimension and eq op', () => {
    const onChange = vi.fn();
    render(<FilterListEditor filters={[]} dimensions={DIMS} parameters={PARAMS} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /add filter/i }));
    expect(onChange).toHaveBeenCalledWith([{ dimension: 'status', op: 'eq', value: '' }]);
  });

  it('binds a value to a parameter, serialising {{param.id}}', () => {
    const onChange = vi.fn();
    const filters: BuilderFilter[] = [{ dimension: 'status', op: 'eq', value: '' }];
    render(<FilterListEditor filters={filters} dimensions={DIMS} parameters={PARAMS} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /filter-0-mode-param/i }));
    fireEvent.change(screen.getByLabelText('filter-0-param'), { target: { value: 'site' } });
    expect(onChange).toHaveBeenLastCalledWith([{ dimension: 'status', op: 'eq', value: '{{param.site}}' }]);
  });

  it('unbinds a parameter value back to a literal', () => {
    const onChange = vi.fn();
    const filters: BuilderFilter[] = [{ dimension: 'status', op: 'eq', value: '{{param.site}}' }];
    render(<FilterListEditor filters={filters} dimensions={DIMS} parameters={PARAMS} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /filter-0-mode-literal/i }));
    expect(onChange).toHaveBeenLastCalledWith([{ dimension: 'status', op: 'eq', value: '' }]);
  });

  it('splits an `in` literal on commas into an array', () => {
    const onChange = vi.fn();
    const filters: BuilderFilter[] = [{ dimension: 'status', op: 'in', value: '' }];
    render(<FilterListEditor filters={filters} dimensions={DIMS} parameters={PARAMS} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('filter-0-value'), { target: { value: 'a, b ,c' } });
    expect(onChange).toHaveBeenLastCalledWith([{ dimension: 'status', op: 'in', value: ['a', 'b', 'c'] }]);
  });
});
