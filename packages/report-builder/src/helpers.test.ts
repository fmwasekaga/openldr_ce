import { describe, it, expect } from 'vitest';
import { createEmptyTemplate, interpolate } from './helpers';
import { ReportTemplateSchema } from './schema';

describe('createEmptyTemplate', () => {
  it('produces a schema-valid draft with the given id and name', () => {
    const t = createEmptyTemplate('rt1', 'My report');
    expect(() => ReportTemplateSchema.parse(t)).not.toThrow();
    expect(t.id).toBe('rt1');
    expect(t.name).toBe('My report');
    expect(t.status).toBe('draft');
    expect(t.rows).toEqual([]);
  });
});

describe('interpolate', () => {
  const ctx = { params: { facility: 'Ndola' }, dataset: { name: 'Central Lab', total: 1284 } };

  it('replaces param and dataset tokens', () => {
    expect(interpolate('{{param.facility}} — {{dataset.name}}', ctx)).toBe('Ndola — Central Lab');
  });

  it('stringifies non-string dataset values', () => {
    expect(interpolate('n={{dataset.total}}', ctx)).toBe('n=1284');
  });

  it('leaves unknown tokens as empty string', () => {
    expect(interpolate('a{{param.missing}}b', ctx)).toBe('ab');
  });

  it('ignores malformed tokens', () => {
    expect(interpolate('literal {{ not a token }}', ctx)).toBe('literal {{ not a token }}');
  });
});
