import { useState } from 'react';
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

// Stateful harness: onChange updates local state (re-rendering the component like
// production does inside QueryEditor) AND forwards to a spy for assertions.
function Harness({ initial, spy }: { initial: BuilderFilter[]; spy: (f: BuilderFilter[]) => void }) {
  const [filters, setFilters] = useState<BuilderFilter[]>(initial);
  return (
    <FilterListEditor
      filters={filters}
      dimensions={DIMS}
      parameters={PARAMS}
      onChange={(f) => { setFilters(f); spy(f); }}
    />
  );
}

describe('FilterListEditor', () => {
  it('adds a filter with the first dimension and eq op', () => {
    const spy = vi.fn();
    render(<Harness initial={[]} spy={spy} />);
    fireEvent.click(screen.getByRole('button', { name: /add filter/i }));
    expect(spy).toHaveBeenCalledWith([{ dimension: 'status', op: 'eq', value: '' }]);
  });

  it('binds a value to a parameter, serialising {{param.id}}', () => {
    const spy = vi.fn();
    render(<Harness initial={[{ dimension: 'status', op: 'eq', value: '' }]} spy={spy} />);
    fireEvent.click(screen.getByRole('button', { name: /filter-0-mode-param/i }));
    fireEvent.change(screen.getByLabelText('filter-0-param'), { target: { value: 'site' } });
    expect(spy).toHaveBeenLastCalledWith([{ dimension: 'status', op: 'eq', value: '{{param.site}}' }]);
  });

  it('unbinds a parameter value back to a literal', () => {
    const spy = vi.fn();
    render(<Harness initial={[{ dimension: 'status', op: 'eq', value: '{{param.site}}' }]} spy={spy} />);
    fireEvent.click(screen.getByRole('button', { name: /filter-0-mode-literal/i }));
    expect(spy).toHaveBeenLastCalledWith([{ dimension: 'status', op: 'eq', value: '' }]);
  });

  it('splits an `in` literal on commas into an array', () => {
    const spy = vi.fn();
    render(<Harness initial={[{ dimension: 'status', op: 'in', value: '' }]} spy={spy} />);
    fireEvent.change(screen.getByLabelText('filter-0-value'), { target: { value: 'a, b ,c' } });
    expect(spy).toHaveBeenLastCalledWith([{ dimension: 'status', op: 'in', value: ['a', 'b', 'c'] }]);
  });
});
