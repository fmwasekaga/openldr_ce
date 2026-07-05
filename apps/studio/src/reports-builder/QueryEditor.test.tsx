import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { Block, ReportParam } from '@openldr/report-builder/pure';

vi.mock('../api', () => ({
  listModels: vi.fn().mockResolvedValue([
    { id: 'observations', label: 'Results', dimensions: [{ key: 'code_text', label: 'Analyte', column: 'code_text', kind: 'string' }, { key: 'status', label: 'Status', column: 'status', kind: 'string' }], metrics: [{ key: 'count', label: 'Count', agg: 'count' }] },
  ]),
}));

import { QueryEditor } from './QueryEditor';

const chartBlock = { kind: 'chart', query: { mode: 'builder', model: 'observations', metric: { key: 'count', agg: 'count' }, filters: [] }, chartType: 'bar', visual: {} } as any;

describe('QueryEditor', () => {
  it('renders the builder source select once models load', async () => {
    render(<QueryEditor block={chartBlock} parameters={[]} onChange={() => {}} />);
    await waitFor(() => expect(screen.getByLabelText(/source/i)).toBeInTheDocument());
  });
  it('changes chart type and patches the block', async () => {
    const onChange = vi.fn();
    render(<QueryEditor block={chartBlock} parameters={[]} onChange={onChange} />);
    await waitFor(() => screen.getByLabelText(/source/i));
    fireEvent.click(screen.getByRole('button', { name: /line/i }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ chartType: 'line' }));
  });
  it('toggles a table block between primary dataset and its own query', async () => {
    const onChange = vi.fn();
    const tableBlock = { kind: 'table', source: 'primary', columns: [] } as any;
    render(<QueryEditor block={tableBlock} parameters={[]} onChange={onChange} />);
    await waitFor(() => screen.getByText(/primary dataset/i));
    fireEvent.click(screen.getByRole('button', { name: /own query/i }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ source: expect.objectContaining({ mode: 'builder' }) }));
  });
});

const MODEL_PARAMS: ReportParam[] = [{ id: 'site', label: 'Site', type: 'select', required: false }];

describe('QueryEditor filters', () => {
  beforeEach(() => vi.clearAllMocks());

  it('adds a filter to a kpi block query', async () => {
    const block: Block = { kind: 'kpi', query: { mode: 'builder', model: 'observations', metric: { key: 'count', agg: 'count' }, filters: [] }, label: '' } as any;
    const onChange = vi.fn();
    render(<QueryEditor block={block} parameters={MODEL_PARAMS} onChange={onChange} />);
    await waitFor(() => screen.getByRole('button', { name: /add filter/i }));
    fireEvent.click(screen.getByRole('button', { name: /add filter/i }));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ query: expect.objectContaining({ filters: [{ dimension: 'code_text', op: 'eq', value: '' }] }) }),
    );
  });
});

describe('QueryEditor SQL mode', () => {
  beforeEach(() => vi.clearAllMocks());

  it('disables the SQL toggle for a builder block when sqlEnabled is false', () => {
    const block: Block = { kind: 'kpi', query: { mode: 'builder', model: 'observations', metric: { key: 'count', agg: 'count' }, filters: [] }, label: '' };
    render(<QueryEditor block={block} parameters={[]} sqlEnabled={false} onChange={() => {}} />);
    expect(screen.getByRole('button', { name: /^sql$/i })).toBeDisabled();
  });

  it('switches a builder block to a seeded sql query when SQL is enabled', () => {
    const block: Block = { kind: 'kpi', query: { mode: 'builder', model: 'observations', metric: { key: 'count', agg: 'count' }, filters: [] }, label: '' };
    const onChange = vi.fn();
    render(<QueryEditor block={block} parameters={[]} sqlEnabled onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /^sql$/i }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ query: { mode: 'sql', sql: 'select 1 as value', values: {} } }));
  });

  it('shows Edit SQL for an existing sql block even when sqlEnabled is false', () => {
    const block: Block = { kind: 'kpi', query: { mode: 'sql', sql: 'select 2 as value', values: {} }, label: '' };
    render(<QueryEditor block={block} parameters={[]} sqlEnabled={false} onChange={() => {}} />);
    expect(screen.getByRole('button', { name: /edit sql/i })).toBeTruthy();
  });
});

describe('QueryEditor breakdown', () => {
  beforeEach(() => vi.clearAllMocks());

  it('writes query.breakdown for a chart block when a breakdown dimension is picked', async () => {
    const block: Block = { kind: 'chart', chartType: 'bar', visual: {}, query: { mode: 'builder', model: 'observations', metric: { key: 'count', agg: 'count' }, dimension: { key: 'status' }, filters: [] } };
    const onChange = vi.fn();
    render(<QueryEditor block={block} parameters={[]} onChange={onChange} />);
    const sel = await screen.findByLabelText('Breakdown');
    fireEvent.change(sel, { target: { value: 'code_text' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ query: expect.objectContaining({ breakdown: { key: 'code_text' } }) }));
  });
});

describe('QueryEditor multi-metric (Slice A)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('adds a metric to a table own-query and writes source.metrics', async () => {
    const block: Block = { kind: 'table', columns: [], source: { mode: 'builder', model: 'observations', metric: { key: 'count', agg: 'count' }, filters: [] } } as any;
    const onChange = vi.fn();
    render(<QueryEditor block={block} parameters={[]} onChange={onChange} />);
    await waitFor(() => screen.getByRole('button', { name: /add metric/i }));
    fireEvent.click(screen.getByRole('button', { name: /add metric/i }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      source: expect.objectContaining({ metrics: [expect.objectContaining({ key: 'm1', agg: 'count' })] }),
    }));
  });
});
