import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const createReportTemplate = vi.fn().mockResolvedValue({ id: 'new-id', name: 'Untitled report', status: 'draft', description: '', category: 'operational', page: { size: 'A4', orientation: 'portrait', margins: { top: 40, right: 40, bottom: 40, left: 40 } }, parameters: [], rows: [] });
vi.mock('../api', () => ({
  getReportTemplate: vi.fn(async () => new Promise(() => {})),
  createReportTemplate: (...a: unknown[]) => createReportTemplate(...a),
  updateReportTemplate: vi.fn().mockResolvedValue({ id: 'rt1', status: 'draft', description: '', category: 'operational', page: { size: 'A4', orientation: 'portrait', margins: { top: 40, right: 40, bottom: 40, left: 40 } }, parameters: [], rows: [] }),
  deleteReportTemplate: vi.fn(),
  previewReportTemplate: vi.fn(),
  listPluginUis: vi.fn(async () => []),
}));
vi.mock('../reports/PdfCanvasViewer', () => ({ PdfCanvasViewer: () => <div /> }));

import { ReportBuilderPage } from './ReportBuilderPage';

beforeEach(() => createReportTemplate.mockClear());

function renderNew() {
  return render(<MemoryRouter initialEntries={['/reports/builder/new']}><Routes><Route path="/reports/builder/new" element={<ReportBuilderPage />} /><Route path="/reports/builder/:id" element={<ReportBuilderPage />} /></Routes></MemoryRouter>);
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
});
