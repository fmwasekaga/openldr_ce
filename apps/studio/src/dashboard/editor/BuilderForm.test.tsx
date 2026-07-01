import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { BuilderForm } from './BuilderForm';
import type { QueryModel } from '../../api';

const models: QueryModel[] = [{ id: 'service_requests', label: 'Test Orders', metrics: [{ key: 'count', label: 'Count', agg: 'count' }], dimensions: [{ key: 'status', label: 'Status', column: 'status', kind: 'string' }] }];

describe('BuilderForm', () => {
  it('emits a builder query when a dimension is chosen', () => {
    const onChange = vi.fn();
    const { getByLabelText } = render(<BuilderForm models={models} value={{ mode: 'builder', model: 'service_requests', metric: { key: 'count', agg: 'count' }, filters: [] }} onChange={onChange} />);
    fireEvent.change(getByLabelText('Group by'), { target: { value: 'status' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ dimension: expect.objectContaining({ key: 'status' }) }));
  });
});
