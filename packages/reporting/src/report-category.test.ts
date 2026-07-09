import { describe, it, expect } from 'vitest';
import { ReportCategoryListSchema, DEFAULT_REPORT_CATEGORIES } from './report-category';

describe('ReportCategoryListSchema', () => {
  it('parses a valid list of category entries', () => {
    const parsed = ReportCategoryListSchema.parse([
      { id: 'amr', label: 'AMR / Surveillance', order: 0 },
      { id: 'operational', label: 'Operational', order: 1 },
    ]);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toEqual({ id: 'amr', label: 'AMR / Surveillance', order: 0 });
  });

  it('accepts an empty list', () => {
    expect(ReportCategoryListSchema.parse([])).toEqual([]);
  });

  it('rejects an entry with an empty id', () => {
    expect(() => ReportCategoryListSchema.parse([{ id: '', label: 'X', order: 0 }])).toThrow();
  });

  it('rejects an entry with an empty label', () => {
    expect(() => ReportCategoryListSchema.parse([{ id: 'x', label: '', order: 0 }])).toThrow();
  });

  it('rejects an entry missing order', () => {
    expect(() => ReportCategoryListSchema.parse([{ id: 'x', label: 'X' }])).toThrow();
  });

  it('rejects a non-array', () => {
    expect(() => ReportCategoryListSchema.parse({ id: 'x' })).toThrow();
  });
});

describe('DEFAULT_REPORT_CATEGORIES', () => {
  it('has the 4 built-in category ids the seeded reports already use, in order', () => {
    expect(DEFAULT_REPORT_CATEGORIES.map((c) => c.id)).toEqual(['amr', 'operational', 'quality', 'regulatory']);
    expect(DEFAULT_REPORT_CATEGORIES.map((c) => c.order)).toEqual([0, 1, 2, 3]);
    expect(ReportCategoryListSchema.parse(DEFAULT_REPORT_CATEGORIES)).toEqual(DEFAULT_REPORT_CATEGORIES);
  });
});
