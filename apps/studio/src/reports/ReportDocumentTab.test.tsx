import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('./PdfCanvasViewer', () => ({ PdfCanvasViewer: () => <div>pdf-viewer</div> }));
vi.mock('../api', () => ({ fetchReportPdf: vi.fn(async () => new Blob(['%PDF'])) }));

import { ReportDocumentTab } from './ReportDocumentTab';

describe('ReportDocumentTab', () => {
  it('fetches the PDF and renders the viewer', async () => {
    render(<ReportDocumentTab reportId="amr-resistance" params={{ from: '2026-01-01' }} />);
    expect(await screen.findByText('pdf-viewer')).toBeInTheDocument();
  });
});
