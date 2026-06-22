import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@/i18n';
import { ReportSpreadsheetTab } from './ReportSpreadsheetTab';
import type { ReportResult } from '../api';

const result: ReportResult = {
  columns: [
    { key: 'antibiotic', label: 'Antibiotic', kind: 'string' },
    { key: 'percentR', label: '%R', kind: 'percent' },
  ],
  rows: [{ antibiotic: 'AMP', percentR: 40 }, { antibiotic: 'CIP', percentR: 60 }],
  chart: { type: 'bar', x: 'antibiotic', y: 'percentR' },
  meta: { generatedAt: '2026-01-01', rowCount: 2 },
};

describe('ReportSpreadsheetTab', () => {
  it('renders rows and a CSV export link', () => {
    render(<ReportSpreadsheetTab reportId="amr-resistance" result={result} params={{ from: '2026-01-01' }} />);
    expect(screen.getByText('AMP')).toBeInTheDocument();
    expect(screen.getByText('40%')).toBeInTheDocument();
    const csv = screen.getByRole('link', { name: /csv/i });
    expect(csv).toHaveAttribute('href', '/api/reports/amr-resistance.csv?from=2026-01-01');
  });
});
