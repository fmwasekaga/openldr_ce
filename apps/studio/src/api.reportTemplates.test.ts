import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchReportTemplates, getReportTemplate, createReportTemplate, updateReportTemplate, deleteReportTemplate, previewReportTemplate } from './api';

describe('report-template api client', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ id: 'rt1' }), { status: 200, headers: { 'content-type': 'application/json' } })));
  });

  it('calls the report-template endpoints with the right method', async () => {
    await fetchReportTemplates();
    await getReportTemplate('rt1');
    await createReportTemplate({ id: 'rt1', name: 'R' } as never);
    await updateReportTemplate('rt1', { id: 'rt1', name: 'R2' } as never);
    await deleteReportTemplate('rt1');

    expect(fetch).toHaveBeenNthCalledWith(1, '/api/report-templates');
    expect(fetch).toHaveBeenNthCalledWith(2, '/api/report-templates/rt1');
    expect(fetch).toHaveBeenNthCalledWith(3, '/api/report-templates', expect.objectContaining({ method: 'POST' }));
    expect(fetch).toHaveBeenNthCalledWith(4, '/api/report-templates/rt1', expect.objectContaining({ method: 'PUT' }));
    expect(fetch).toHaveBeenNthCalledWith(5, '/api/report-templates/rt1', expect.objectContaining({ method: 'DELETE' }));
  });

  it('previewReportTemplate POSTs and returns a Blob', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('%PDF-1.4', { status: 200, headers: { 'content-type': 'application/pdf' } })));
    const blob = await previewReportTemplate('rt1', { who: 'x' });
    expect(blob).toBeInstanceOf(Blob);
    expect(fetch).toHaveBeenNthCalledWith(1, '/api/report-templates/rt1/preview', expect.objectContaining({ method: 'POST' }));
  });
});
