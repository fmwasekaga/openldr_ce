import { describe, it, expect } from 'vitest';
import { templateToSummary, isPublished } from './index';

const tpl = { id: 'rt-1', name: 'Custom AMR', description: 'd', category: 'amr', status: 'published', parameters: [{ id: 'from', label: 'From', type: 'daterange', required: false }], rows: [] } as never;

describe('reporting template helpers', () => {
  it('maps a template to a builder-source ReportSummary', () => {
    const s = templateToSummary(tpl);
    expect(s).toMatchObject({ id: 'rt-1', name: 'Custom AMR', category: 'amr', source: 'builder' });
    expect(s.parameters).toHaveLength(1);
  });
  it('isPublished only accepts published status', () => {
    expect(isPublished({ status: 'published' } as never)).toBe(true);
    expect(isPublished({ status: 'draft' } as never)).toBe(false);
  });
});
