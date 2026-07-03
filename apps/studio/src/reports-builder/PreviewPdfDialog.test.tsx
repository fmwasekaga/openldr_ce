import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

vi.mock('../api', () => ({ previewReportTemplate: vi.fn().mockResolvedValue(new Blob(['%PDF-'], { type: 'application/pdf' })) }));
vi.mock('../reports/PdfCanvasViewer', () => ({ PdfCanvasViewer: ({ blob }: { blob: Blob }) => <div data-testid="viewer">{blob ? 'pdf' : 'none'}</div> }));

import { PreviewPdfDialog } from './PreviewPdfDialog';
import { previewReportTemplate } from '../api';

describe('PreviewPdfDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches the preview blob and renders the viewer when open', async () => {
    render(<PreviewPdfDialog open reportId="rt1" params={{}} onClose={() => {}} />);
    await waitFor(() => expect(previewReportTemplate).toHaveBeenCalledWith('rt1', {}));
    await waitFor(() => expect(screen.getByTestId('viewer')).toHaveTextContent('pdf'));
  });
  it('does not fetch when closed', () => {
    render(<PreviewPdfDialog open={false} reportId="rt1" params={{}} onClose={() => {}} />);
    expect(previewReportTemplate).not.toHaveBeenCalled();
  });
});
