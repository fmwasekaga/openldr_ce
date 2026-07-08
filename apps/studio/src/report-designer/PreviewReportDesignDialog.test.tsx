import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { beforeEach, it, expect, vi } from 'vitest';
import { PreviewReportDesignDialog } from './PreviewReportDesignDialog';

vi.mock('../api', () => ({ previewReportDesign: vi.fn(async () => new Blob(['%PDF'], { type: 'application/pdf' })) }));
vi.mock('../reports/PdfCanvasViewer', () => ({ PdfCanvasViewer: () => <div data-testid="pdf-viewer" /> }));

beforeEach(() => { vi.clearAllMocks(); });

it('fetches and renders the design PDF when open', async () => {
  const design = { id: 'd', name: 'N', paper: 'A4', orientation: 'portrait', parameters: [], pages: [] } as never;
  render(<PreviewReportDesignDialog open design={design} onOpenChange={vi.fn()} />);
  const { previewReportDesign } = await import('../api');
  await waitFor(() => expect(previewReportDesign).toHaveBeenCalledWith(design));
  expect(await screen.findByTestId('pdf-viewer')).toBeInTheDocument();
});

it('closes via the X button', async () => {
  const design = { id: 'd', name: 'N', paper: 'A4', orientation: 'portrait', parameters: [], pages: [] } as never;
  const onOpenChange = vi.fn();
  render(<PreviewReportDesignDialog open design={design} onOpenChange={onOpenChange} />);
  fireEvent.click(screen.getByLabelText('Close'));
  expect(onOpenChange).toHaveBeenCalledWith(false);
});

it('does not fetch when closed', async () => {
  const design = { id: 'd', name: 'N', paper: 'A4', orientation: 'portrait', parameters: [], pages: [] } as never;
  render(<PreviewReportDesignDialog open={false} design={design} onOpenChange={vi.fn()} />);
  const { previewReportDesign } = await import('../api');
  expect(previewReportDesign).not.toHaveBeenCalled();
});
