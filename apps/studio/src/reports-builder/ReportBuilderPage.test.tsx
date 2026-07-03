import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const PAGE = { size: 'A4', orientation: 'portrait', margins: { top: 40, right: 40, bottom: 40, left: 40 } } as const;
const createReportTemplate = vi.fn().mockResolvedValue({ id: 'new-id', name: 'Untitled report', status: 'draft', description: '', category: 'operational', page: PAGE, parameters: [], rows: [] });
const getReportTemplate = vi.fn((..._a: unknown[]): Promise<unknown> => new Promise(() => {}));
const updateReportTemplate = vi.fn().mockResolvedValue({ id: 'rt1', name: 'Report', status: 'draft', description: '', category: 'operational', page: PAGE, parameters: [], rows: [] });
const previewReportTemplate = vi.fn().mockResolvedValue(new Blob(['%PDF'], { type: 'application/pdf' }));
vi.mock('../api', () => ({
  getReportTemplate: (...a: unknown[]) => getReportTemplate(...a),
  createReportTemplate: (...a: unknown[]) => createReportTemplate(...a),
  updateReportTemplate: (...a: unknown[]) => updateReportTemplate(...a),
  deleteReportTemplate: vi.fn(),
  previewReportTemplate: (...a: unknown[]) => previewReportTemplate(...a),
  listPluginUis: vi.fn(async () => []),
  runWidgetQuery: vi.fn().mockResolvedValue({ columns: [], rows: [], chart: {}, meta: { generatedAt: 'n', rowCount: 0 } }),
  listModels: vi.fn().mockResolvedValue([]),
}));
vi.mock('../reports/PdfCanvasViewer', () => ({ PdfCanvasViewer: () => <div /> }));

import { ReportBuilderPage } from './ReportBuilderPage';

beforeEach(() => {
  createReportTemplate.mockClear();
  getReportTemplate.mockReset();
  getReportTemplate.mockImplementation(async () => new Promise(() => {}));
  updateReportTemplate.mockClear();
  previewReportTemplate.mockClear();
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
  it('routes entered parameter values into the PDF preview', async () => {
    getReportTemplate.mockResolvedValue({ id: 'rt1', name: 'Report', status: 'draft', description: '', category: 'operational', page: PAGE, parameters: [{ id: 'q', label: 'Query', type: 'text', required: false }], rows: [] });
    renderId('rt1');
    fireEvent.change(await screen.findByLabelText('Query'), { target: { value: 'abc' } });
    fireEvent.click(screen.getByRole('button', { name: /preview pdf/i }));
    await waitFor(() => expect(previewReportTemplate).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ q: 'abc' })));
  });
});
