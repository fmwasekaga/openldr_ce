import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { MeasuresEditor } from './MeasuresEditor';
import type { QueryModel } from '../../api';

const model: QueryModel = {
  id: 'observations', label: 'Results',
  dimensions: [{ key: 'interpretation_code', label: 'Interpretation', column: 'abnormal_flag', kind: 'string' }],
  metrics: [{ key: 'count', label: 'Count', agg: 'count' }, { key: 'avg_value', label: 'Avg', agg: 'avg', column: 'numeric_value' }],
} as unknown as QueryModel;

describe('MeasuresEditor', () => {
  it('renders a row per measure and the add controls', () => {
    const list = [{ key: 'count', label: 'Count', agg: 'count' }];
    const { getByLabelText, getByText } = render(<MeasuresEditor value={list} model={model} onChange={vi.fn()} />);
    expect(getByLabelText('Add measure')).toBeTruthy();
    expect(getByLabelText('Add formula')).toBeTruthy();
    expect(getByText('Count')).toBeTruthy();
  });
});
