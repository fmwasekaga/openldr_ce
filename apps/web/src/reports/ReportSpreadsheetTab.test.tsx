import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@/i18n';

const { downloadReportCsv } = vi.hoisted(() => ({ downloadReportCsv: vi.fn(async () => {}) }));
vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>();
  return { ...actual, downloadReportCsv };
});

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
  it('renders rows with percent formatting', () => {
    render(<ReportSpreadsheetTab reportId="amr-resistance" result={result} params={{ from: '2026-01-01' }} />);
    expect(screen.getByText('AMP')).toBeInTheDocument();
    expect(screen.getByText('40%')).toBeInTheDocument();
  });

  it('downloads CSV via authenticated helper and fires onExport', async () => {
    const onExport = vi.fn();
    render(<ReportSpreadsheetTab reportId="amr-resistance" result={result} params={{ from: '2026-01-01' }} onExport={onExport} />);
    fireEvent.click(screen.getByRole('button', { name: /csv/i }));
    expect(downloadReportCsv).toHaveBeenCalledWith('amr-resistance', { from: '2026-01-01' });
    await Promise.resolve();
    expect(onExport).toHaveBeenCalledWith('csv', 2);
  });
});
