import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CanvasBlock } from './CanvasBlock';

vi.mock('../dashboard/widgets', () => ({ renderWidget: (config: { type: string }, result?: { columns?: { key: string }[] }) => <div data-testid="widget" data-cols={result?.columns?.map((c) => c.key).join(',') ?? ''}>{config.type}</div> }));

describe('CanvasBlock', () => {
  it('renders title text', () => {
    render(<CanvasBlock block={{ kind: 'title', text: 'Hello', style: { fontSize: 16 } } as never} />);
    expect(screen.getByText('Hello')).toBeInTheDocument();
  });
  it('renders a chart placeholder labelled by chart type', () => {
    render(<CanvasBlock block={{ kind: 'chart', query: {} as never, chartType: 'bar', visual: {} } as never} />);
    expect(screen.getByText(/bar chart/i)).toBeInTheDocument();
  });
  it('renders a table placeholder', () => {
    render(<CanvasBlock block={{ kind: 'table', source: 'primary', columns: [] } as never} />);
    expect(screen.getByText(/table/i)).toBeInTheDocument();
  });
});

describe('CanvasBlock live data', () => {
  const result = { columns: [{ key: 'label', label: 'L', kind: 'string' }, { key: 'value', label: 'V', kind: 'number' }], rows: [{ label: 'a', value: 1 }], chart: {}, meta: { generatedAt: 'n', rowCount: 1 } } as any;
  it('renders a chart block via ReportChart (not the generic widget)', () => {
    const { container } = render(<CanvasBlock block={{ kind: 'chart', query: {} as never, chartType: 'bar', visual: {} } as never} data={{ result, loading: false }} />);
    expect(screen.queryByTestId('widget')).toBeNull();
    expect(container.querySelector('.recharts-responsive-container')).toBeInTheDocument();
  });
  it('renders a kpi block via the generic widget', () => {
    render(<CanvasBlock block={{ kind: 'kpi', query: {} as never, label: 'X' } as never} data={{ result, loading: false }} />);
    expect(screen.getByTestId('widget')).toBeInTheDocument();
  });
  it('shows a loading state', () => {
    render(<CanvasBlock block={{ kind: 'kpi', query: {} as never, label: 'X' } as never} data={{ loading: true }} />);
    expect(screen.getByText(/loading|…/i)).toBeInTheDocument();
  });
  it('shows an error state', () => {
    render(<CanvasBlock block={{ kind: 'chart', query: {} as never, chartType: 'bar', visual: {} } as never} data={{ error: 'boom', loading: false }} />);
    expect(screen.getByText(/boom/i)).toBeInTheDocument();
  });
  it('renders a table with a breakdown source as a pivoted matrix', () => {
    const block = { kind: 'table', columns: [], source: { mode: 'builder', model: 'observations', metric: { key: 'count', agg: 'count' }, dimension: { key: 'code_text' }, breakdown: { key: 'interpretation_code' }, filters: [] } };
    const breakdownResult = { columns: [{ key: 'label', label: 'Analyte', kind: 'string' }, { key: 'series', kind: 'string' }, { key: 'value', kind: 'number' }], rows: [ { label: 'Amp', series: 'R', value: 5 }, { label: 'Amp', series: 'S', value: 3 } ] };
    render(<CanvasBlock block={block as never} data={{ result: breakdownResult as never, loading: false }} />);
    const cols = screen.getByTestId('widget').getAttribute('data-cols');
    expect(cols).toBe('label,R,S');       // pivoted breakdown columns
    expect(cols).not.toContain('series'); // NOT the raw long-result column
  });
});
