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

  it('generates a non-colliding key after a remove', () => {
    const onChange = vi.fn();
    render(<MetricsListEditor metrics={[{ key: 'm2', agg: 'count' }]} dimensions={dims} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /add metric/i }));
    expect(onChange).toHaveBeenCalledWith([{ key: 'm2', agg: 'count' }, expect.objectContaining({ key: 'm3' })]);
  });
});

describe('MetricsListEditor ratio metrics (Slice B)', () => {
  it('toggles a metric to a ratio with default numerator/denominator/decimals', () => {
    const onChange = vi.fn();
    render(<MetricsListEditor metrics={[{ key: 'tested', label: 'Tested', agg: 'count' }, { key: 'r', label: 'R', agg: 'count' }]} dimensions={dims} onChange={onChange} />);
    const ratioButtons = screen.getAllByRole('button', { name: /^ratio$/i });
    fireEvent.click(ratioButtons[1]);
    expect(onChange).toHaveBeenCalledWith([
      { key: 'tested', label: 'Tested', agg: 'count' },
      expect.objectContaining({ key: 'r', derived: { numerator: 'tested', denominator: 'tested', scale: 100, decimals: 1 } }),
    ]);
  });

  it('edits the ratio numerator from the other aggregate metrics', () => {
    const onChange = vi.fn();
    render(<MetricsListEditor metrics={[
      { key: 'tested', label: 'Tested', agg: 'count' },
      { key: 'r', label: 'R', agg: 'count' },
      { key: 'pct', label: '%R', agg: 'count', derived: { numerator: 'tested', denominator: 'tested', scale: 100, decimals: 1 } },
    ]} dimensions={dims} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText(/numerator/i), { target: { value: 'r' } });
    expect(onChange).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ key: 'pct', derived: expect.objectContaining({ numerator: 'r' }) }),
    ]));
  });

  it('toggling back to Column clears derived', () => {
    const onChange = vi.fn();
    render(<MetricsListEditor metrics={[
      { key: 'tested', agg: 'count' },
      { key: 'pct', agg: 'count', derived: { numerator: 'tested', denominator: 'tested', scale: 100, decimals: 1 } },
    ]} dimensions={dims} onChange={onChange} />);
    const colButtons = screen.getAllByRole('button', { name: /^column$/i });
    fireEvent.click(colButtons[1]);
    expect(onChange).toHaveBeenCalledWith([
      { key: 'tested', agg: 'count' },
      expect.objectContaining({ key: 'pct', derived: undefined }),
    ]);
  });
});
