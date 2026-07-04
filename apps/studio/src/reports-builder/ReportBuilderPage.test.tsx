import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const PAGE = { size: 'A4', orientation: 'portrait', margins: { top: 40, right: 40, bottom: 40, left: 40 } } as const;
const createReportTemplate = vi.fn().mockResolvedValue({ id: 'new-id', name: 'Untitled report', status: 'draft', description: '', category: 'operational', page: PAGE, parameters: [], rows: [] });
const getReportTemplate = vi.fn((..._a: unknown[]): Promise<unknown> => new Promise(() => {}));
const updateReportTemplate = vi.fn().mockResolvedValue({ id: 'rt1', name: 'Report', status: 'draft', description: '', category: 'operational', page: PAGE, parameters: [], rows: [] });
const previewReportTemplate = vi.fn().mockResolvedValue(new Blob(['%PDF'], { type: 'application/pdf' }));
const fetchClientConfig = vi.fn().mockResolvedValue({ dashboardSqlEnabled: true, authEnforced: false, version: '', environment: '', oidc: null });
const deleteReportTemplate = vi.fn().mockResolvedValue(undefined);
vi.mock('../api', () => ({
  getReportTemplate: (...a: unknown[]) => getReportTemplate(...a),
  createReportTemplate: (...a: unknown[]) => createReportTemplate(...a),
  updateReportTemplate: (...a: unknown[]) => updateReportTemplate(...a),
  deleteReportTemplate: (...a: unknown[]) => deleteReportTemplate(...a),
  previewReportTemplate: (...a: unknown[]) => previewReportTemplate(...a),
  listPluginUis: vi.fn(async () => []),
  runWidgetQuery: vi.fn().mockResolvedValue({ columns: [], rows: [], chart: {}, meta: { generatedAt: 'n', rowCount: 0 } }),
  listModels: vi.fn().mockResolvedValue([]),
  fetchClientConfig: (...a: unknown[]) => fetchClientConfig(...a),
}));
vi.mock('../reports/PdfCanvasViewer', () => ({ PdfCanvasViewer: () => <div /> }));

import { ReportBuilderPage } from './ReportBuilderPage';

beforeEach(() => {
  createReportTemplate.mockClear();
  getReportTemplate.mockReset();
  getReportTemplate.mockImplementation(async () => new Promise(() => {}));
  updateReportTemplate.mockClear();
  previewReportTemplate.mockClear();
  fetchClientConfig.mockClear();
  deleteReportTemplate.mockClear();
});

function renderNew() {
  return render(<MemoryRouter initialEntries={['/reports/builder/new']}><Routes><Route path="/reports/builder/new" element={<ReportBuilderPage />} /><Route path="/reports/builder/:id" element={<ReportBuilderPage />} /></Routes></MemoryRouter>);
}

function renderId(id: string) {
  return render(<MemoryRouter initialEntries={[`/reports/builder/${id}`]}><Routes><Route path="/reports/builder/new" element={<ReportBuilderPage />} /><Route path="/reports/builder/:id" element={<ReportBuilderPage />} /></Routes></MemoryRouter>);
}

describe('ReportBuilderPage', () => {
  it('renders the name input and the palette', () => {
    renderNew();
    expect(screen.getByLabelText(/report name/i)).toBeInTheDocument();
    expect(screen.getByText('Chart')).toBeInTheDocument();
  });
  it('adds a block via the palette and shows it on the canvas', () => {
    renderNew();
    fireEvent.click(screen.getByText('Title'));
    expect(screen.getByTestId('canvas-cell-0-0')).toBeInTheDocument();
  });
  it('saves via createReportTemplate', async () => {
    renderNew();
    fireEvent.click(screen.getByText('Title'));
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => expect(createReportTemplate).toHaveBeenCalled());
  });
  it('fetches the client config for SQL gating on mount', async () => {
    renderNew();
    await waitFor(() => expect(fetchClientConfig).toHaveBeenCalled());
  });
  it('routes entered parameter values into the PDF preview', async () => {
    getReportTemplate.mockResolvedValue({ id: 'rt1', name: 'Report', status: 'draft', description: '', category: 'operational', page: PAGE, parameters: [{ id: 'q', label: 'Query', type: 'text', required: false }], rows: [] });
    renderId('rt1');
    fireEvent.change(await screen.findByLabelText('Query'), { target: { value: 'abc' } });
    fireEvent.click(screen.getByRole('button', { name: /preview pdf/i }));
    await waitFor(() => expect(previewReportTemplate).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ q: 'abc' })));
  });
  it('does not refetch (clobber) after saving a new report', async () => {
    createReportTemplate.mockResolvedValueOnce({ id: 'rt-new', name: 'Untitled report', status: 'draft', description: '', category: 'operational', page: PAGE, parameters: [], rows: [] });
    renderNew();
    fireEvent.click(await screen.findByRole('button', { name: /^save$/i }));
    await waitFor(() => expect(createReportTemplate).toHaveBeenCalled());
    expect(getReportTemplate).not.toHaveBeenCalledWith('rt-new');
  });
  it('does not delete until the confirmation is accepted', async () => {
    getReportTemplate.mockResolvedValue({ id: 'rt1', name: 'Report', status: 'draft', description: '', category: 'operational', page: PAGE, parameters: [], rows: [] });
    renderId('rt1');
    fireEvent.click(await screen.findByRole('button', { name: /^delete$/i }));
    expect(deleteReportTemplate).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole('button', { name: /^delete report$/i }));
    await waitFor(() => expect(deleteReportTemplate).toHaveBeenCalled());
  });
  it('disables Publish when the template has a lint error', async () => {
    const t = { id: 'rt1', name: 'R', description: '', category: 'operational', status: 'draft',
      page: { size: 'A4', orientation: 'portrait', margins: { top: 40, right: 40, bottom: 40, left: 40 } },
      parameters: [], rows: [{ id: 'r', cells: [{ colSpan: 12, block: { kind: 'kpi', label: '', query: { mode: 'builder', model: '', metric: { key: 'count', agg: 'count' }, filters: [] } } }] }] };
    vi.mocked(getReportTemplate).mockResolvedValue(t as never);
    renderId('rt1');
    expect(await screen.findByRole('button', { name: /^publish$/i })).toBeDisabled();
  });

  it('enables Publish for a clean template', async () => {
    const t = { id: 'rt1', name: 'R', description: '', category: 'operational', status: 'draft',
      page: { size: 'A4', orientation: 'portrait', margins: { top: 40, right: 40, bottom: 40, left: 40 } },
      parameters: [], rows: [{ id: 'r', cells: [{ colSpan: 12, block: { kind: 'kpi', label: '', query: { mode: 'builder', model: 'm', metric: { key: 'count', agg: 'count' }, filters: [] } } }] }] };
    vi.mocked(getReportTemplate).mockResolvedValue(t as never);
    renderId('rt1');
    expect(await screen.findByRole('button', { name: /^publish$/i })).toBeEnabled();
  });

  it('duplicates the selected block row on Ctrl+D and ignores keys while typing in an input', async () => {
    const t = { id: 'rt1', name: 'R', description: '', category: 'operational', status: 'draft',
      page: { size: 'A4', orientation: 'portrait', margins: { top: 40, right: 40, bottom: 40, left: 40 } },
      parameters: [], rows: [{ id: 'r0', cells: [{ colSpan: 12, block: { kind: 'title', text: 'A', style: {} } }] }] };
    vi.mocked(getReportTemplate).mockResolvedValue(t as never);
    renderId('rt1');
    fireEvent.click(await screen.findByTestId('canvas-cell-0-0')); // select the block
    // typing guard: keydown targeted at the name input must NOT duplicate
    fireEvent.keyDown(screen.getByLabelText(/report name/i), { key: 'd', ctrlKey: true });
    expect(screen.queryByTestId('canvas-cell-1-0')).toBeNull();
    // Ctrl+D on the document duplicates the row → a second cell appears
    fireEvent.keyDown(document, { key: 'd', ctrlKey: true });
    expect(await screen.findByTestId('canvas-cell-1-0')).toBeTruthy();
  });
});
