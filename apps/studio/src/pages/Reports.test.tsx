import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';

const designReport = {
  id: 'r1', name: 'Custom Report', description: 'desc', category: 'operational', parameters: [], summaryMetrics: [], source: 'design', designId: 'd1',
};

const { fetchReportsMock } = vi.hoisted(() => ({
  fetchReportsMock: vi.fn(async () => [
    { id: 'amr-resistance', name: 'AMR Resistance Rate', description: 'desc', category: 'amr', parameters: [{ id: 'dateRange', label: 'Date range', type: 'daterange', required: false }], summaryMetrics: [{ id: 'antibiotics', label: 'Antibiotics', type: 'count' }], source: 'catalog' },
  ]),
}));

vi.mock('../api', () => ({
  fetchReports: fetchReportsMock,
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

const { setReportStatus, deleteReportDef } = vi.hoisted(() => ({
  setReportStatus: vi.fn(async () => {}),
  deleteReportDef: vi.fn(async () => {}),
}));
vi.mock('../reports/reportDefsApi', () => ({ setReportStatus, deleteReportDef }));

import { Reports } from './Reports';

// Exact 'Actions' name — distinguishes the report-detail ⋯ menu from the library header's
// "Library actions" ⋯ menu, which also matches a loose /actions/i pattern.
function openActionsMenu() {
  const trigger = screen.getByRole('button', { name: 'Actions' });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  if (!document.querySelector('[role="menu"]')) fireEvent.keyDown(trigger, { key: 'Enter' });
}

beforeEach(() => {
  localStorage.clear();
  fetchReportsMock.mockClear();
  setReportStatus.mockClear();
  deleteReportDef.mockClear();
});

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
    openActionsMenu();
    fireEvent.click(await screen.findByText(/schedules|planifications|agendamentos/i));
    expect(await screen.findByText('schedules-drawer')).toBeInTheDocument();
  });

  it('unpublishes a design-sourced report, clears selection, and refetches', async () => {
    fetchReportsMock.mockResolvedValue([designReport]);
    render(<MemoryRouter><Reports /></MemoryRouter>);
    fireEvent.click(await screen.findByText('Custom Report'));
    openActionsMenu();
    fireEvent.click(await screen.findByText(/unpublish|dépublier|despublicar/i));
    await waitFor(() => expect(setReportStatus).toHaveBeenCalledWith('r1', 'draft'));
    await waitFor(() => expect(screen.getByText(/select a report|sélectionnez un rapport|selecione um relatório/i)).toBeInTheDocument());
    expect(fetchReportsMock.mock.calls.length).toBeGreaterThan(1);
  });

  it('deletes a design-sourced report after confirmation, clears selection, and refetches', async () => {
    fetchReportsMock.mockResolvedValue([designReport]);
    render(<MemoryRouter><Reports /></MemoryRouter>);
    fireEvent.click(await screen.findByText('Custom Report'));
    openActionsMenu();
    fireEvent.click(await screen.findByText(/delete report|supprimer le rapport|excluir relatório/i));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /delete report|supprimer le rapport|excluir relatório/i }));
    await waitFor(() => expect(deleteReportDef).toHaveBeenCalledWith('r1'));
    await waitFor(() => expect(screen.getByText(/select a report|sélectionnez un rapport|selecione um relatório/i)).toBeInTheDocument());
    expect(fetchReportsMock.mock.calls.length).toBeGreaterThan(1);
  });
});
