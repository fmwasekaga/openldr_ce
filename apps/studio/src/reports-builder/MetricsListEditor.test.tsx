import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import { MetricsListEditor } from './MetricsListEditor';

const dims = [
  { key: 'code_text', label: 'Analyte', column: 'code_text', kind: 'string' as const },
  { key: 'interpretation_code', label: 'Interpretation', column: 'interpretation_code', kind: 'string' as const },
];

describe('MetricsListEditor', () => {
  it('adds a count metric with a generated key', () => {
    const onChange = vi.fn();
    render(<MetricsListEditor metrics={[]} dimensions={dims} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /add metric/i }));
    expect(onChange).toHaveBeenCalledWith([expect.objectContaining({ key: 'm1', agg: 'count' })]);
  });

  it('removes a metric', () => {
    const onChange = vi.fn();
    render(<MetricsListEditor metrics={[{ key: 'r', label: 'R', agg: 'count' }]} dimensions={dims} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /remove metric/i }));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it('edits a metric label', () => {
    const onChange = vi.fn();
    render(<MetricsListEditor metrics={[{ key: 'm1', label: '', agg: 'count' }]} dimensions={dims} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Metric label'), { target: { value: 'Tested' } });
    expect(onChange).toHaveBeenCalledWith([expect.objectContaining({ key: 'm1', label: 'Tested' })]);
  });
});
