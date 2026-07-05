import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';

vi.mock('../api', () => ({
  fetchReports: vi.fn(async () => [
    { id: 'amr-resistance', name: 'AMR Resistance Rate', description: 'desc', category: 'amr', parameters: [{ id: 'dateRange', label: 'Date range', type: 'daterange', required: false }], summaryMetrics: [{ id: 'antibiotics', label: 'Antibiotics', type: 'count' }], source: 'catalog' },
    { id: 'custom-1', name: 'My Custom Report', description: 'built', category: 'operational', parameters: [], source: 'builder' },
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
  listPluginUis: vi.fn(async () => []),
}));
vi.mock('../reports/PdfCanvasViewer', () => ({ PdfCanvasViewer: () => <div>pdf-viewer</div> }));
vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'me', username: 'me', displayName: null, roles: ['lab_admin'] }, loading: false, hasRole: () => true }),
}));
vi.mock('../reports/ReportSchedulesDrawer', () => ({
  ReportSchedulesDrawer: ({ open }: { open: boolean }) => (open ? <div>schedules-drawer</div> : null),
}));

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

  it('opens the Schedules drawer for a manager', async () => {
    render(<MemoryRouter><Reports /></MemoryRouter>);
    fireEvent.click(await screen.findByText('AMR Resistance Rate'));
    const trigger = screen.getByRole('button', { name: /actions|more/i });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    fireEvent.keyDown(trigger, { key: 'Enter' });
    fireEvent.click(await screen.findByText(/schedules|planifications|agendamentos/i));
    expect(await screen.findByText('schedules-drawer')).toBeInTheDocument();
  });

  it('custom (builder) report shows only the PDF experience — no Spreadsheet tab', async () => {
    render(<MemoryRouter><Reports /></MemoryRouter>);
    fireEvent.click(await screen.findByText('My Custom Report'));
    // PDF viewer is shown directly (no tabular Run required).
    await waitFor(() => expect(screen.getByText('pdf-viewer')).toBeInTheDocument());
    // The tabular Spreadsheet tab trigger must NOT be present.
    expect(screen.queryByRole('button', { name: /spreadsheet|feuille|planilha/i })).not.toBeInTheDocument();
  });

  it('custom report never fetches tabular data', async () => {
    const api = await import('../api');
    (api.fetchReport as ReturnType<typeof vi.fn>).mockClear();
    render(<MemoryRouter><Reports /></MemoryRouter>);
    fireEvent.click(await screen.findByText('My Custom Report'));
    await waitFor(() => expect(screen.getByText('pdf-viewer')).toBeInTheDocument());
    expect(api.fetchReport).not.toHaveBeenCalled();
  });
});
