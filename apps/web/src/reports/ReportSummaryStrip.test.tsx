import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ReportSummaryStrip } from './ReportSummaryStrip';

describe('ReportSummaryStrip', () => {
  it('renders metric label/value pairs', () => {
    render(<ReportSummaryStrip metrics={[{ id: 'a', label: 'Avg %R', value: '50' }]} />);
    expect(screen.getByText('Avg %R')).toBeInTheDocument();
    expect(screen.getByText('50')).toBeInTheDocument();
  });

  it('renders nothing when there are no metrics', () => {
    const { container } = render(<ReportSummaryStrip metrics={[]} />);
    expect(container.firstChild).toBeNull();
  });
});
