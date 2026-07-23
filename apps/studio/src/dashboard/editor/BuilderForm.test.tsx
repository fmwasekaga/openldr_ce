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
    tableColumns: [],
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
  it('renders the Data, Measure, Group by, and Breakdown controls', () => {
    const onChange = vi.fn();
    // Group by / Breakdown are now on-demand sections; populate them so the shown-set initializer renders them.
    const full = { ...base, dimension: { key: 'status' }, breakdown: { key: 'priority' } } as Extract<WidgetQuery, { mode: 'builder' }>;
    const { getByLabelText } = render(<BuilderForm models={models} value={full} onChange={onChange} />);
    expect(getByLabelText('Data')).toBeTruthy();
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
        tableColumns: [],
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

  it('renders a Limit control only when the Sort section is present', () => {
    // Sort (row-limit) is now its own removable section, independent of group-by/breakdown.
    const { queryByLabelText } = render(<BuilderForm models={models} value={base} onChange={vi.fn()} />);
    expect(queryByLabelText('Limit')).toBeNull();
    const withLimit = { ...base, limit: 10 } as Extract<WidgetQuery, { mode: 'builder' }>;
    const { getByLabelText } = render(<BuilderForm models={models} value={withLimit} onChange={vi.fn()} />);
    expect(getByLabelText('Limit')).toBeTruthy();
  });

  it('renders the AND/OR filter tree root controls after adding the Filter section', () => {
    render(<BuilderForm models={models} value={base} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /^filter$/i }));
    expect(screen.getByLabelText('Add condition')).toBeTruthy();
    expect(screen.getByLabelText('Add group')).toBeTruthy();
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
  optionalJoins: [{ alias: 'jp', label: 'Patient', left: 'patient_id', right: 'id', exposableColumns: ['sex', 'managing_organization'] }],
}] as never;
const builderValue = { mode: 'builder', model: 'service_requests', metric: { key: 'count', agg: 'count', label: 'Count' }, filters: [] } as never;

describe('BuilderForm Add menu + join column', () => {
  it('offers a "Join data" button when the model has optional joins', () => {
    render(<BuilderForm models={modelsWithJoin} value={builderValue} onChange={() => {}} />);
    // Join data appears twice: the icon-only button under Data and the labeled tile in the bottom row.
    expect(screen.getAllByRole('button', { name: /join data/i })).toHaveLength(2);
  });

  it('the relationship card × removes every column for that relationship', () => {
    const onChange = vi.fn();
    const value = {
      mode: 'builder', model: 'service_requests', metric: { key: 'count', agg: 'count', label: 'Count' }, filters: [],
      adhocDimensions: [
        { key: 'jp__sex', label: 'Patient → Sex', join: 'jp', column: 'sex', kind: 'string' },
        { key: 'jp__managing_organization', label: 'Patient → Managing Organization', join: 'jp', column: 'managing_organization', kind: 'string' },
      ],
    } as never;
    render(<BuilderForm models={modelsWithJoin} value={value} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /remove join: patient/i }));
    const last = onChange.mock.calls.at(-1)![0];
    expect(last.adhocDimensions ?? []).toHaveLength(0);
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

  it('adds join columns through the Join data picker and emits them on change', () => {
    const onChange = vi.fn();
    render(<BuilderForm models={modelsWithJoin} value={builderValue} onChange={onChange} />);
    // Either instance (icon button under Data, or the bottom labeled tile) opens the same picker.
    fireEvent.click(screen.getAllByRole('button', { name: /join data/i })[0]);
    fireEvent.click(screen.getByLabelText('sex'));       // check the column
    fireEvent.click(screen.getByRole('button', { name: /apply/i }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      adhocDimensions: [expect.objectContaining({ key: 'jp__sex', column: 'sex' })],
    }));
  });

  it('shows Join data and Custom column as buttons under Data', () => {
    render(<BuilderForm models={modelsWithJoin} value={builderValue} onChange={() => {}} />);
    // Each also appears again as a labeled tile in the bottom add row.
    expect(screen.getAllByRole('button', { name: /join data/i })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: /custom column/i })).toHaveLength(2);
  });
});

const modelsFix = [{
  id: 'service_requests', label: 'Test Orders',
  dimensions: [{ key: 'status', label: 'Status', column: 'status', kind: 'string' }],
  metrics: [{ key: 'count', label: 'Count', agg: 'count' }],
  optionalJoins: [{ alias: 'jp', label: 'Patient', exposableColumns: ['sex'] }],
}] as never;
const withMeasure = { mode: 'builder', model: 'service_requests', metric: { key: 'count', agg: 'count', label: 'Count' }, filters: [] } as never;

describe('BuilderForm custom columns', () => {
  it('offers a "Custom column" tile', () => {
    render(<BuilderForm models={models} value={base} onChange={() => {}} />);
    // Custom column appears twice: the icon-only button under Data and the labeled bottom tile.
    expect(screen.getAllByRole('button', { name: /custom column/i })).toHaveLength(2);
  });

  it('renders active custom columns in a card and removes one on ×', () => {
    const onChange = vi.fn();
    const value = { ...base, customColumns: [{ key: 'sp', label: 'Status/Priority', expr: { kind: 'concat', parts: [{ type: 'field', dimension: 'status' }] } }] } as never;
    render(<BuilderForm models={models} value={value} onChange={onChange} />);
    expect(screen.getByText('Status/Priority')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /remove Status\/Priority/i }));
    const last = onChange.mock.calls.at(-1)![0];
    expect(last.customColumns ?? []).toHaveLength(0);
  });
});

describe('BuilderForm minimal-core sections', () => {
  it('pins only Data; Group by / Breakdown are NOT shown until added', () => {
    render(<BuilderForm models={modelsFix} value={withMeasure} onChange={() => {}} />);
    expect(screen.getByLabelText('Data')).toBeInTheDocument();
    expect(screen.queryByLabelText('Group by')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Breakdown')).not.toBeInTheDocument();
  });

  it('summarize shows by default when the query has a measure', () => {
    render(<BuilderForm models={modelsFix} value={withMeasure} onChange={() => {}} />);
    expect(screen.getByText(/summarize/i)).toBeInTheDocument();
  });

  it('adding "Group by" from the Add tiles reveals the Group by section', () => {
    render(<BuilderForm models={modelsFix} value={withMeasure} onChange={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /^group by$/i }));
    expect(screen.getByLabelText('Group by')).toBeInTheDocument();
  });

  it('renders a no-measure query without crashing', () => {
    const noMeasure = { mode: 'builder', model: 'service_requests', filters: [] } as never;
    expect(() => render(<BuilderForm models={modelsFix} value={noMeasure} onChange={() => {}} />)).not.toThrow();
  });

  it('removing the Summarize section clears the measure (emits metric-less query)', () => {
    const onChange = vi.fn();
    render(<BuilderForm models={modelsFix} value={withMeasure} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /remove summarize/i }));
    const last = onChange.mock.calls.at(-1)![0];
    expect(last.metric).toBeUndefined();
    expect(last.metrics).toBeUndefined();
  });
});

// --- User-defined joins (arbitrary joins against the admin-governed joinable-table universe) ---

const joinableTablesFixture = [
  { table: 'patients', label: 'Patient', columns: ['sex'], primaryKeys: ['id'], allColumns: ['id', 'patient_id', 'sex'] },
];

// This model has NO curated optionalJoins — arbitrary joins must still be reachable, since a
// model with only one FK (or none) is exactly the case curated joins alone can't serve.
const modelsNoCuratedJoins: QueryModel[] = [
  {
    id: 'service_requests', label: 'Test Orders',
    dimensions: [{ key: 'status', label: 'Status', column: 'status', kind: 'string' }],
    metrics: [{ key: 'count', label: 'Count', agg: 'count' }],
    tableColumns: ['id', 'patient_id', 'status'],
  },
];
const baseNoJoins = { mode: 'builder', model: 'service_requests', metric: { key: 'count', agg: 'count', label: 'Count' }, filters: [] } as Extract<WidgetQuery, { mode: 'builder' }>;

describe('BuilderForm user-defined joins', () => {
  it('offers "Join data" (and reaches "+ Add a join") even when the model has no curated optionalJoins', () => {
    render(<BuilderForm models={modelsNoCuratedJoins} value={baseNoJoins} joinableTables={joinableTablesFixture} onChange={() => {}} />);
    // Join data appears twice (icon under Data + bottom tile) purely because joinableTables is non-empty.
    fireEvent.click(screen.getAllByRole('button', { name: /join data/i })[0]);
    expect(screen.getByRole('button', { name: /\+ add a join/i })).toBeInTheDocument();
  });

  it('"+ Add a join" emits a userJoins entry', () => {
    const onChange = vi.fn();
    render(<BuilderForm models={modelsNoCuratedJoins} value={baseNoJoins} joinableTables={joinableTablesFixture} onChange={onChange} />);
    fireEvent.click(screen.getAllByRole('button', { name: /join data/i })[0]);
    fireEvent.click(screen.getByRole('button', { name: /\+ add a join/i }));
    const last = onChange.mock.calls.at(-1)![0];
    expect(last.userJoins).toEqual([expect.objectContaining({ id: 'u1', table: 'patients', label: 'Patient' })]);
  });

  it('renders a UserJoinBuilder block for each entry in value.userJoins', () => {
    const withUserJoin = { ...baseNoJoins, userJoins: [{ id: 'u1', table: 'patients', left: 'patient_id', right: 'id', label: 'Patient' }] } as Extract<WidgetQuery, { mode: 'builder' }>;
    render(<BuilderForm models={modelsNoCuratedJoins} value={withUserJoin} joinableTables={joinableTablesFixture} onChange={() => {}} />);
    expect(screen.getByText('Join: Patient')).toBeInTheDocument();
    expect(screen.getByLabelText('sex')).toBeInTheDocument();
  });

  it('removing a user join clears its ad-hoc columns and group-by reference', () => {
    const onChange = vi.fn();
    const withRef = {
      ...baseNoJoins,
      userJoins: [{ id: 'u1', table: 'patients', left: 'patient_id', right: 'id', label: 'Patient' }],
      adhocDimensions: [{ key: 'u1__sex', label: 'Patient → Sex', join: 'u1', column: 'sex', kind: 'string' as const }],
      dimension: { key: 'u1__sex' },
    } as Extract<WidgetQuery, { mode: 'builder' }>;
    render(<BuilderForm models={modelsNoCuratedJoins} value={withRef} joinableTables={joinableTablesFixture} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /remove join u1/i }));
    const last = onChange.mock.calls.at(-1)![0];
    expect(last.userJoins ?? []).toHaveLength(0);
    expect(last.adhocDimensions ?? []).toHaveLength(0);
    expect(last.dimension).toBeUndefined();
  });
});
