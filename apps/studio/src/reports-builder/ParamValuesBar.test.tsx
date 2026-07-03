import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ParamValuesBar } from './ParamValuesBar';
import type { ReportParam } from '@openldr/report-builder/pure';
import { runWidgetQuery } from '../api';

vi.mock('../api', () => ({ runWidgetQuery: vi.fn() }));

describe('ParamValuesBar', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders nothing when there are no parameters', () => {
    const { container } = render(<ParamValuesBar parameters={[]} values={{}} onChange={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it('writes a text value on change', () => {
    const params: ReportParam[] = [{ id: 'q', label: 'Query', type: 'text', required: false }];
    const onChange = vi.fn();
    render(<ParamValuesBar parameters={params} values={{}} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Query'), { target: { value: 'abc' } });
    expect(onChange).toHaveBeenCalledWith({ q: 'abc' });
  });

  it('runs optionsSql to populate a select parameter', async () => {
    vi.mocked(runWidgetQuery).mockResolvedValue({ columns: [{ key: 'name' }], rows: [{ name: 'Ndola' }, { name: 'Lusaka' }] } as never);
    const params: ReportParam[] = [{ id: 'site', label: 'Site', type: 'select', required: false, optionsSql: 'SELECT name FROM sites' }];
    render(<ParamValuesBar parameters={params} values={{}} onChange={() => {}} />);
    await waitFor(() => expect(runWidgetQuery).toHaveBeenCalledWith({ mode: 'sql', sql: 'SELECT name FROM sites' }));
  });
});
