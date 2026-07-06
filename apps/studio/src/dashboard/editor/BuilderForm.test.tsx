import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import { BuilderForm } from './BuilderForm';
import type { QueryModel } from '../../api';

const models: QueryModel[] = [
  { id: 'service_requests', label: 'Test Orders', metrics: [{ key: 'count', label: 'Count', agg: 'count' }], dimensions: [{ key: 'status', label: 'Status', column: 'status', kind: 'string' }] },
  { id: 'observations', label: 'Results', metrics: [{ key: 'count', label: 'Count', agg: 'count' }], dimensions: [{ key: 'code_text', label: 'Analyte', column: 'code_text', kind: 'string' }] },
];

describe('BuilderForm', () => {
  it('emits a builder query when a dimension is chosen', () => {
    const onChange = vi.fn();
    const { getByLabelText } = render(<BuilderForm models={models} value={{ mode: 'builder', model: 'service_requests', metric: { key: 'count', agg: 'count' }, filters: [] }} onChange={onChange} />);
    fireEvent.change(getByLabelText('Group by'), { target: { value: 'status' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ dimension: expect.objectContaining({ key: 'status' }) }));
  });
});

describe('BuilderForm conditional metric (Slice A)', () => {
  it('sets metric.where when a condition is added', () => {
    const onChange = vi.fn();
    render(<BuilderForm models={models} value={{ mode: 'builder', model: 'service_requests', metric: { key: 'count', agg: 'count' }, filters: [] }} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /add condition/i }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      metric: expect.objectContaining({ where: [{ dimension: 'status', op: 'eq', value: '' }] }),
    }));
  });

  it('clears stale metrics[] when the source model changes', () => {
    const onChange = vi.fn();
    render(<BuilderForm models={models} value={{ mode: 'builder', model: 'service_requests', metric: { key: 'count', agg: 'count' }, metrics: [{ key: 'm1', agg: 'count' }], filters: [] }} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Source'), { target: { value: 'observations' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ model: 'observations', metrics: undefined }));
  });

  it('clears the stale filterTree (and flat filters) when the source model changes', () => {
    const onChange = vi.fn();
    render(<BuilderForm models={models} value={{
      mode: 'builder', model: 'service_requests', metric: { key: 'count', agg: 'count' }, filters: [],
      filterTree: { kind: 'group', combinator: 'and', children: [{ kind: 'rule', dimension: 'status', op: 'eq', value: 'x' }] },
    }} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Source'), { target: { value: 'observations' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ model: 'observations', filterTree: undefined, filters: [] }));
  });
});
