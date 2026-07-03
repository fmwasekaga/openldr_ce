import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../api', () => ({
  listModels: vi.fn().mockResolvedValue([
    { id: 'observations', label: 'Results', dimensions: [{ key: 'code_text', label: 'Analyte', column: 'code_text', kind: 'string' }], metrics: [{ key: 'count', label: 'Count', agg: 'count' }] },
  ]),
}));

import { QueryEditor } from './QueryEditor';

const chartBlock = { kind: 'chart', query: { mode: 'builder', model: 'observations', metric: { key: 'count', agg: 'count' }, filters: [] }, chartType: 'bar', visual: {} } as any;

describe('QueryEditor', () => {
  it('renders the builder source select once models load', async () => {
    render(<QueryEditor block={chartBlock} onChange={() => {}} />);
    await waitFor(() => expect(screen.getByLabelText(/source/i)).toBeInTheDocument());
  });
  it('changes chart type and patches the block', async () => {
    const onChange = vi.fn();
    render(<QueryEditor block={chartBlock} onChange={onChange} />);
    await waitFor(() => screen.getByLabelText(/source/i));
    fireEvent.click(screen.getByRole('button', { name: /line/i }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ chartType: 'line' }));
  });
  it('toggles a table block between primary dataset and its own query', async () => {
    const onChange = vi.fn();
    const tableBlock = { kind: 'table', source: 'primary', columns: [] } as any;
    render(<QueryEditor block={tableBlock} onChange={onChange} />);
    await waitFor(() => screen.getByText(/primary dataset/i));
    fireEvent.click(screen.getByRole('button', { name: /own query/i }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ source: expect.objectContaining({ mode: 'builder' }) }));
  });
});
