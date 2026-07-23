import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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

const modelsWithJoin = [{
  id: 'service_requests', label: 'Test Orders',
  dimensions: [{ key: 'status', label: 'Status', column: 'status', kind: 'string' }],
  metrics: [{ key: 'count', label: 'Count', agg: 'count' }],
  optionalJoins: [{ alias: 'jp', label: 'Patient', exposableColumns: ['sex', 'managing_organization'] }],
}] as never;
const builderValue = { mode: 'builder', model: 'service_requests', metric: { key: 'count', agg: 'count', label: 'Count' }, filters: [] } as never;

describe('BuilderForm Add menu + join column', () => {
  it('offers "Join column" in the Add menu when the model has optional joins', () => {
    render(<BuilderForm models={modelsWithJoin} value={builderValue} onChange={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /add clause/i }));
    expect(screen.getByText(/join column/i)).toBeInTheDocument();
  });

  it('lists an added adhoc dimension as a Filter field option', () => {
    const value = {
      mode: 'builder', model: 'service_requests', metric: { key: 'count', agg: 'count', label: 'Count' },
      adhocDimensions: [{ key: 'jp__sex', label: 'Patient Sex', join: 'jp', column: 'sex', kind: 'string' }],
      filterTree: { kind: 'group', combinator: 'and', children: [{ kind: 'rule', dimension: 'status', op: 'eq', value: '' }] },
    } as never;
    render(<BuilderForm models={modelsWithJoin} value={value} onChange={() => {}} />);
    fireEvent.click(screen.getByLabelText('Filter field'));
    expect(screen.getByRole('option', { name: 'Patient Sex' })).toBeInTheDocument();
  });

  it('renders a Grain control for an adhoc date column used as group-by', () => {
    const value = {
      mode: 'builder', model: 'service_requests', metric: { key: 'count', agg: 'count', label: 'Count' }, filters: [],
      adhocDimensions: [{ key: 'jp__created', label: 'Created', join: 'jp', column: 'created_at', kind: 'date' }],
      dimension: { key: 'jp__created' },
    } as never;
    render(<BuilderForm models={modelsWithJoin} value={value} onChange={() => {}} />);
    expect(screen.getByLabelText('Grain')).toBeInTheDocument();
  });

  it('adds an adhoc dimension through the picker and emits it on change', () => {
    const onChange = vi.fn();
    render(<BuilderForm models={modelsWithJoin} value={builderValue} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /add clause/i }));
    fireEvent.click(screen.getByText(/join column/i));
    // choose column 'sex' via the real Radix Select (Column has aria-label="Column" inside JoinColumnPicker):
    fireEvent.click(screen.getByLabelText('Column'));
    fireEvent.click(screen.getByRole('option', { name: 'sex' }));
    fireEvent.click(screen.getByRole('button', { name: /add column/i }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      adhocDimensions: [expect.objectContaining({ key: 'jp__sex', column: 'sex' })],
    }));
  });
});
