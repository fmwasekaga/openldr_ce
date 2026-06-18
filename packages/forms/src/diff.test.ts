import { describe, expect, it } from 'vitest';
import { diffFormSchemas } from './diff';
import type { FormSchema } from './schema/form-schema';

const form = (overrides: Partial<FormSchema> = {}): FormSchema => ({
  id: 'f',
  name: 'Specimen intake',
  title: { en: 'Specimen intake' },
  status: 'draft',
  languages: ['en'],
  sections: [
    {
      id: 'main',
      title: { en: 'Main' },
      fields: [
        { id: 'sample-id', type: 'string', label: { en: 'Sample id' } },
        { id: 'received', type: 'dateTime', label: { en: 'Received' } },
      ],
    },
  ],
  ...overrides,
});

describe('diffFormSchemas', () => {
  it('groups deterministic metadata, section, and field changes', () => {
    const before = form();
    const after = form({
      name: 'Updated intake',
      status: 'active',
      sections: [
        {
          id: 'main',
          title: { en: 'Main details' },
          fields: [
            { id: 'sample-id', type: 'text', label: { en: 'Sample id' } },
            { id: 'collector', type: 'string', label: { en: 'Collector' } },
          ],
        },
        { id: 'review', title: { en: 'Review' }, fields: [] },
      ],
    });

    expect(diffFormSchemas(before, after)).toEqual({
      metadata: [
        { kind: 'changed', path: 'name', before: 'Specimen intake', after: 'Updated intake' },
        { kind: 'changed', path: 'status', before: 'draft', after: 'active' },
      ],
      sections: [
        { kind: 'changed', sectionId: 'main', path: 'title', before: { en: 'Main' }, after: { en: 'Main details' } },
        { kind: 'added', sectionId: 'review', after: { id: 'review', title: { en: 'Review' }, fields: [] } },
      ],
      fields: [
        { kind: 'changed', sectionId: 'main', fieldId: 'sample-id', path: 'type', before: 'string', after: 'text' },
        { kind: 'removed', sectionId: 'main', fieldId: 'received', before: { id: 'received', type: 'dateTime', label: { en: 'Received' } } },
        { kind: 'added', sectionId: 'main', fieldId: 'collector', after: { id: 'collector', type: 'string', label: { en: 'Collector' } } },
      ],
    });
  });
});
