import { beforeEach, describe, expect, it, vi } from 'vitest';
import { listReportDesigns, getReportDesign, createReportDesign, updateReportDesign, deleteReportDesign, previewReportDesign, downloadReportDesignPdf } from './api';

describe('report-design api client', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ id: 'rd1' }), { status: 200, headers: { 'content-type': 'application/json' } })));
  });

  it('calls the report-design endpoints with the right method', async () => {
    await listReportDesigns();
    await getReportDesign('rd1');
    await createReportDesign({ id: 'rd1', name: 'R' } as never);
    await updateReportDesign('rd1', { id: 'rd1', name: 'R2' } as never);
    await deleteReportDesign('rd1');

    expect(fetch).toHaveBeenNthCalledWith(1, '/api/report-designs');
    expect(fetch).toHaveBeenNthCalledWith(2, '/api/report-designs/rd1');
    expect(fetch).toHaveBeenNthCalledWith(3, '/api/report-designs', expect.objectContaining({ method: 'POST' }));
    expect(fetch).toHaveBeenNthCalledWith(4, '/api/report-designs/rd1', expect.objectContaining({ method: 'PUT' }));
    expect(fetch).toHaveBeenNthCalledWith(5, '/api/report-designs/rd1', expect.objectContaining({ method: 'DELETE' }));
  });

  it('previewReportDesign POSTs the design and returns a Blob', async () => {
    const blob = new Blob(['%PDF'], { type: 'application/pdf' });
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, blob: async () => blob } as never);
    const design = { id: 'd', name: 'N' } as never;
    const out = await previewReportDesign(design);
    expect(fetch).toHaveBeenCalledWith('/api/report-designs/preview', expect.objectContaining({ method: 'POST' }));
    expect(out).toBe(blob);
  });

  it('downloadReportDesignPdf renders via the preview endpoint and downloads a sanitized .pdf', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, blob: async () => new Blob(['%PDF'], { type: 'application/pdf' }) } as never);
    // jsdom lacks these blob-URL helpers — stub them for the test, then remove.
    const g = URL as unknown as Record<string, unknown>;
    g.createObjectURL = vi.fn(() => 'blob:x');
    g.revokeObjectURL = vi.fn();
    const clicked: string[] = [];
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function (this: HTMLAnchorElement) { clicked.push(this.download); });

    await downloadReportDesignPdf({ id: 'd', name: 'AMR / summary' } as never);

    expect(fetch).toHaveBeenCalledWith('/api/report-designs/preview', expect.objectContaining({ method: 'POST' }));
    expect(clicked).toEqual(['AMR_summary.pdf']); // reuses the preview endpoint + sanitizes the filename
    expect(g.createObjectURL).toHaveBeenCalledTimes(1);
    expect(g.revokeObjectURL).toHaveBeenCalledTimes(1);

    clickSpy.mockRestore();
    delete g.createObjectURL;
    delete g.revokeObjectURL;
  });
});
