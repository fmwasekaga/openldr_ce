import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DataTab } from './DataTab';
import { queryApi } from '../query/api';
import type { DesignElement } from './types';

vi.mock('../query/api', () => ({
  queryApi: {
    list: vi.fn(async () => [{ id: 'cq_1', name: 'AMR', connectorId: 'c1', sql: 'select 1', params: [] }]),
    run: vi.fn(async () => ({ columns: [{ key: 'org', label: 'Organism' }, { key: 'pct', label: '%R' }], rows: [] })),
  },
}));

const tableEl = (over: Partial<DesignElement> = {}): DesignElement => ({
  id: 't', kind: 'table', name: 'Table', rect: { x: 0, y: 0, w: 200, h: 100 }, ...over,
});

function setup(over: Partial<DesignElement> = {}) {
  const onPatchElement = vi.fn();
  const onPatchParameters = vi.fn();
  const utils = render(<DataTab element={tableEl(over)} parameters={[]} onPatchElement={onPatchElement} onPatchParameters={onPatchParameters} />);
  return { onPatchElement, onPatchParameters, ...utils };
}

// The query list resolves asynchronously; retry the Load-columns click until run() fires.
async function loadColumns() {
  const loadBtn = screen.getByRole('button', { name: /load columns/i });
  await waitFor(() => {
    fireEvent.click(loadBtn);
    expect(queryApi.run).toHaveBeenCalled();
  });
}

describe('DataTab table binding', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('shows a hint when the selected element is not a table', () => {
    render(<DataTab element={undefined} parameters={[]} onPatchElement={vi.fn()} onPatchParameters={vi.fn()} />);
    expect(screen.getByText(/select a table/i)).toBeInTheDocument();
  });

  it('binds the table to a picked custom query (discrete)', async () => {
    const { onPatchElement } = setup();
    fireEvent.click(screen.getByLabelText('Bind query'));
    const opt = await screen.findByText('AMR');
    fireEvent.click(opt);
    expect(onPatchElement).toHaveBeenCalledWith('t', { dataSource: { kind: 'custom-query', queryId: 'cq_1' } }, { discrete: true });
  });

  it('loads result columns and includes one into boundColumns (discrete)', async () => {
    const { onPatchElement } = setup({ dataSource: { kind: 'custom-query', queryId: 'cq_1' } });
    await loadColumns();
    fireEvent.click(await screen.findByLabelText('org'));
    expect(onPatchElement).toHaveBeenCalledWith('t', { boundColumns: [{ key: 'org', label: 'Organism' }] }, { discrete: true });
  });

  it('relabelling an included column is coalesced (no discrete opt)', async () => {
    const { onPatchElement } = setup({
      dataSource: { kind: 'custom-query', queryId: 'cq_1' },
      boundColumns: [{ key: 'org', label: 'Organism' }],
    });
    // The label Input for the included column carries the translated aria-label suffixed with the key.
    fireEvent.change(screen.getByLabelText('Label for column org'), { target: { value: 'Bug' } });
    expect(onPatchElement).toHaveBeenLastCalledWith('t', { boundColumns: [{ key: 'org', label: 'Bug' }] }, undefined);
  });

  it('reorders included columns via move-down (discrete)', async () => {
    const { onPatchElement } = setup({
      dataSource: { kind: 'custom-query', queryId: 'cq_1' },
      boundColumns: [{ key: 'org', label: 'Organism' }, { key: 'pct', label: '%R' }],
    });
    await loadColumns();
    fireEvent.click(screen.getByLabelText('Move down Organism'));
    expect(onPatchElement).toHaveBeenLastCalledWith(
      't',
      { boundColumns: [{ key: 'pct', label: '%R' }, { key: 'org', label: 'Organism' }] },
      { discrete: true },
    );
  });

  it('renders the error line when the query run rejects', async () => {
    (queryApi.run as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('boom'));
    setup({ dataSource: { kind: 'custom-query', queryId: 'cq_1' } });
    await loadColumns();
    expect(await screen.findByText('Could not load columns. Check the query and its parameters.')).toBeInTheDocument();
  });

  it('recovers the Load button when the element is switched mid-flight', async () => {
    // A deferred run() that stays pending until we resolve it, simulating an in-flight load.
    let resolveRun: (v: { columns: { key: string; label: string }[]; rows: unknown[] }) => void = () => {};
    (queryApi.run as ReturnType<typeof vi.fn>).mockReturnValueOnce(new Promise((r) => { resolveRun = r; }));

    const props = { parameters: [], onPatchElement: vi.fn(), onPatchParameters: vi.fn() };
    const { rerender } = render(<DataTab element={tableEl({ id: 't', dataSource: { kind: 'custom-query', queryId: 'cq_1' } })} {...props} />);

    const loadBtn = () => screen.getByRole('button', { name: /load columns/i });
    // Fire the load; wait until run() is actually dispatched (queries must be loaded first).
    await waitFor(() => { fireEvent.click(loadBtn()); expect(queryApi.run).toHaveBeenCalled(); });
    expect(loadBtn()).toBeDisabled(); // loading === true while the deferred is pending

    // Switch to a different element while the first run is still pending.
    rerender(<DataTab element={tableEl({ id: 't2', dataSource: { kind: 'custom-query', queryId: 'cq_1' } })} {...props} />);
    // Resolve the stale run late — its result must be ignored, and loading must not stay stuck.
    resolveRun({ columns: [{ key: 'org', label: 'Organism' }], rows: [] });

    await waitFor(() => expect(loadBtn()).not.toBeDisabled());
  });

  it('clears loaded columns when a different element is selected', async () => {
    const onPatchElement = vi.fn();
    const props = { parameters: [], onPatchElement, onPatchParameters: vi.fn() };
    const { rerender } = render(<DataTab element={tableEl({ id: 't', dataSource: { kind: 'custom-query', queryId: 'cq_1' } })} {...props} />);
    await loadColumns();
    expect(await screen.findByLabelText('org')).toBeInTheDocument();
    rerender(<DataTab element={tableEl({ id: 't2', dataSource: { kind: 'custom-query', queryId: 'cq_1' } })} {...props} />);
    expect(screen.queryByLabelText('org')).toBeNull();
    expect(screen.getByText(/no columns loaded/i)).toBeInTheDocument();
  });
});

describe('DataTab design parameters', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('adds and edits a design parameter (text + daterange)', () => {
    const onPatchParameters = vi.fn();
    render(<DataTab element={undefined} parameters={[]} onPatchElement={vi.fn()} onPatchParameters={onPatchParameters} />);
    fireEvent.click(screen.getByText(/add parameter/i));
    expect(onPatchParameters).toHaveBeenCalledWith([expect.objectContaining({ key: expect.any(String), type: 'text' })]);
  });

  it('renders from/to inputs for a daterange param and patches its value', () => {
    const onPatchParameters = vi.fn();
    const params = [{ key: 'range', label: 'Range', type: 'daterange' as const, value: { from: '', to: '' } }];
    render(<DataTab element={undefined} parameters={params} onPatchElement={vi.fn()} onPatchParameters={onPatchParameters} />);
    const from = screen.getByLabelText(/from/i);
    fireEvent.change(from, { target: { value: '2026-01-01' } });
    fireEvent.blur(from);
    expect(onPatchParameters).toHaveBeenCalledWith([expect.objectContaining({ value: { from: '2026-01-01', to: '' } })]);
  });

  it('commits a text param value on blur and removes a param', () => {
    const onPatchParameters = vi.fn();
    const params = [{ key: 'facility', label: 'Facility', type: 'text' as const, value: '' }];
    render(<DataTab element={undefined} parameters={params} onPatchElement={vi.fn()} onPatchParameters={onPatchParameters} />);
    const val = screen.getByLabelText('Value for facility');
    fireEvent.change(val, { target: { value: 'Ndola' } });
    fireEvent.blur(val);
    expect(onPatchParameters).toHaveBeenCalledWith([expect.objectContaining({ value: 'Ndola' })]);
    fireEvent.click(screen.getByLabelText('Remove parameter facility'));
    expect(onPatchParameters).toHaveBeenLastCalledWith([]);
  });
});
