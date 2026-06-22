import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@/i18n'; // side-effect: initialise i18next so useTranslation() resolves

vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: { workerSrc: '' },
  getDocument: () => ({
    promise: Promise.resolve({
      numPages: 1,
      getPage: async () => ({
        getViewport: () => ({ width: 10, height: 10 }),
        render: () => ({ promise: Promise.resolve() }),
      }),
    }),
    destroy: () => {},
  }),
}));
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: 'worker-url' }));

import { PdfCanvasViewer } from './PdfCanvasViewer';

describe('PdfCanvasViewer', () => {
  it('renders a toolbar with a download button', async () => {
    render(<PdfCanvasViewer blob={new Blob(['%PDF'])} fileName="r.pdf" />);
    expect(await screen.findByText(/download|télécharger|baixar/i)).toBeInTheDocument();
  });
});
