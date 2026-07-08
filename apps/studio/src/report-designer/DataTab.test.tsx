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
  render(<DataTab element={tableEl(over)} parameters={[]} onPatchElement={onPatchElement} onPatchParameters={onPatchParameters} />);
  return { onPatchElement, onPatchParameters };
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
    const loadBtn = screen.getByRole('button', { name: /load columns/i });
    // The query list resolves asynchronously; retry the click until run() fires.
    await waitFor(() => {
      fireEvent.click(loadBtn);
      expect(queryApi.run).toHaveBeenCalled();
    });
    const check = await screen.findByLabelText('Organism');
    fireEvent.click(check);
    expect(onPatchElement).toHaveBeenCalledWith('t', { boundColumns: [{ key: 'org', label: 'Organism' }] }, { discrete: true });
  });
});
