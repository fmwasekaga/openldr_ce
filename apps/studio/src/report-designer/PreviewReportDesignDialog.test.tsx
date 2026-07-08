import { render, screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import { PreviewReportDesignDialog } from './PreviewReportDesignDialog';

vi.mock('../api', () => ({ previewReportDesign: vi.fn(async () => new Blob(['%PDF'], { type: 'application/pdf' })) }));
vi.mock('../reports/PdfCanvasViewer', () => ({ PdfCanvasViewer: () => <div data-testid="pdf-viewer" /> }));

it('fetches and renders the design PDF when open', async () => {
  const design = { id: 'd', name: 'N', paper: 'A4', orientation: 'portrait', parameters: [], pages: [] } as never;
  render(<PreviewReportDesignDialog open design={design} onOpenChange={vi.fn()} />);
  const { previewReportDesign } = await import('../api');
  await waitFor(() => expect(previewReportDesign).toHaveBeenCalledWith(design));
  expect(await screen.findByTestId('pdf-viewer')).toBeInTheDocument();
});
