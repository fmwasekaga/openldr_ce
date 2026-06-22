import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';

vi.mock('../api', () => ({
  fetchReports: vi.fn(async () => [
    { id: 'amr-resistance', name: 'AMR Resistance Rate', description: 'desc', category: 'amr', parameters: [{ id: 'dateRange', label: 'Date range', type: 'daterange', required: false }], summaryMetrics: [{ id: 'antibiotics', label: 'Antibiotics', type: 'count' }] },
  ]),
  fetchReport: vi.fn(async () => ({
    columns: [{ key: 'antibiotic', label: 'Antibiotic', kind: 'string' }],
    rows: [{ antibiotic: 'AMP' }],
    chart: { type: 'bar', x: 'antibiotic', y: 'percentR' },
    meta: { generatedAt: '2026-01-01', rowCount: 1 },
  })),
  fetchReportOptions: vi.fn(async () => ({})),
  fetchReportPdf: vi.fn(async () => new Blob(['%PDF'])),
  csvUrl: (id: string) => `/api/reports/${id}.csv`,
  logReportRun: vi.fn(async () => {}),
  fetchReportRuns: vi.fn(async () => ({ runs: [], total: 0 })),
  downloadReportCsv: vi.fn(async () => {}),
}));
vi.mock('../reports/PdfCanvasViewer', () => ({ PdfCanvasViewer: () => <div>pdf-viewer</div> }));

import { Reports } from './Reports';

beforeEach(() => localStorage.clear());

describe('Reports page', () => {
  it('lists reports; selecting + running shows the document tab', async () => {
    render(<MemoryRouter><Reports /></MemoryRouter>);
    fireEvent.click(await screen.findByText('AMR Resistance Rate'));
    fireEvent.click(await screen.findByRole('button', { name: /run|exécuter|executar/i }));
    await waitFor(() => expect(screen.getByText('pdf-viewer')).toBeInTheDocument());
  });

  it('logs a preview run after Run', async () => {
    const api = await import('../api');
    render(<MemoryRouter><Reports /></MemoryRouter>);
    fireEvent.click(await screen.findByText('AMR Resistance Rate'));
    fireEvent.click(await screen.findByRole('button', { name: /run|exécuter|executar/i }));
    await waitFor(() => expect(api.logReportRun).toHaveBeenCalledWith(
      'amr-resistance',
      expect.objectContaining({ format: 'preview' }),
    ));
  });
});
