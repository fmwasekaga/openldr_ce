import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { BuilderForm } from './BuilderForm';
import type { QueryModel, WidgetQuery } from '../../api';

const models: QueryModel[] = [
  {
    id: 'service_requests',
    label: 'Test Orders',
    dimensions: [
      { key: 'status', label: 'Status', column: 'status', kind: 'string' },
      { key: 'priority', label: 'Priority', column: 'priority', kind: 'string' },
    ],
    metrics: [{ key: 'count', label: 'Count', agg: 'count' }],
  },
];
const base = {
  mode: 'builder',
  model: 'service_requests',
  metric: { key: 'count', label: 'Count', agg: 'count' },
  filters: [],
} as Extract<WidgetQuery, { mode: 'builder' }>;

describe('BuilderForm', () => {
  // shadcn/Radix Select renders a combobox, not a native <select>, and jsdom can't reliably
  // open Radix menus (see WidgetEditorDialog.test.tsx). Behavior is covered by
  // builderForm.model.test.ts's pure-function tests; this is a render smoke-test only.
  it('renders the Source, Measure, Group by, and Breakdown controls', () => {
    const onChange = vi.fn();
    const { getByLabelText } = render(<BuilderForm models={models} value={base} onChange={onChange} />);
    expect(getByLabelText('Source')).toBeTruthy();
    expect(getByLabelText('Add measure')).toBeTruthy();
    expect(getByLabelText('Group by')).toBeTruthy();
    expect(getByLabelText('Breakdown')).toBeTruthy();
  });

  it('renders a Grain control when the group-by dimension is a date with dateGrain', () => {
    const dateModels: QueryModel[] = [
      {
        id: 'service_requests',
        label: 'Test Orders',
        dimensions: [{ key: 'collected', label: 'Collected', column: 'collected', kind: 'date', dateGrain: ['day', 'month'] }],
        metrics: [{ key: 'count', label: 'Count', agg: 'count' }],
      },
    ];
    const withDim = { ...base, model: 'service_requests', dimension: { key: 'collected' } } as Extract<WidgetQuery, { mode: 'builder' }>;
    const { getByLabelText } = render(<BuilderForm models={dateModels} value={withDim} onChange={vi.fn()} />);
    expect(getByLabelText('Grain')).toBeTruthy();
  });

  it('omits the Grain control when there is no group-by dimension', () => {
    const { queryByLabelText } = render(<BuilderForm models={models} value={base} onChange={vi.fn()} />);
    expect(queryByLabelText('Grain')).toBeNull();
  });

  it('renders a Limit control only when there is a group-by or breakdown', () => {
    const { queryByLabelText } = render(<BuilderForm models={models} value={base} onChange={vi.fn()} />);
    expect(queryByLabelText('Limit')).toBeNull();
    const grouped = { ...base, dimension: { key: 'status' } } as Extract<WidgetQuery, { mode: 'builder' }>;
    const { getByLabelText } = render(<BuilderForm models={models} value={grouped} onChange={vi.fn()} />);
    expect(getByLabelText('Limit')).toBeTruthy();
  });

  it('renders the AND/OR filter tree root controls', () => {
    const { getByLabelText } = render(<BuilderForm models={models} value={base} onChange={vi.fn()} />);
    expect(getByLabelText('Add condition')).toBeTruthy();
    expect(getByLabelText('Add group')).toBeTruthy();
  });

  it('adapts a legacy flat-filters widget into a tree (renders its rule)', () => {
    const legacy = { ...base, filters: [{ dimension: 'status', op: 'eq', value: 'F' }] } as Extract<WidgetQuery, { mode: 'builder' }>;
    const { getAllByLabelText } = render(<BuilderForm models={models} value={legacy} onChange={vi.fn()} />);
    expect(getAllByLabelText('Filter field').length).toBe(1);
  });
});
