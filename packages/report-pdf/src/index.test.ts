import { describe, it, expect } from 'vitest';
import { renderReportPdf } from './index';

describe('renderReportPdf', () => {
  it('produces a PDF buffer with the %PDF header', async () => {
    const buf = await renderReportPdf({
      title: 'AMR First-Isolate Summary', generatedAt: '2026-06-14T00:00:00Z', params: { from: '2026-01-01' },
      columns: [{ key: 'pathogen', label: 'Pathogen' }, { key: 'percentR', label: '%R' }],
      rows: [{ pathogen: 'eco', percentR: 50 }, { pathogen: 'kpn', percentR: 100 }],
    });
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(buf.length).toBeGreaterThan(500);
  });
  it('handles zero rows', async () => {
    const buf = await renderReportPdf({ title: 'Empty', generatedAt: '2026-06-14T00:00:00Z', params: {}, columns: [{ key: 'a', label: 'A' }], rows: [] });
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
  });
});
