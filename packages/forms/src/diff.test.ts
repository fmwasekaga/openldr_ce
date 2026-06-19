import { describe, expect, it } from 'vitest';
import { diffFormSchemas } from './diff';
import { makeField, makeSchema } from './__fixtures__/forms';
import type { FormSchema } from './schema/form-schema';

function base(overrides: Partial<FormSchema> = {}): FormSchema {
  return makeSchema({
    id: 'f',
    name: 'Specimen intake',
    fields: [
      makeField({ id: 'sample-id', displayLabel: 'Sample id', fieldType: 'text', order: 0 }),
      makeField({ id: 'received', displayLabel: 'Received', fieldType: 'date', order: 1 }),
    ],
    sections: [{ id: 'main', label: 'Main', order: 0 }],
    ...overrides,
  });
}

describe('diffFormSchemas', () => {
  it('returns empty diff for identical forms', () => {
    const form = base();
    const diff = diffFormSchemas(form, form);
    expect(diff.metadata).toEqual([]);
    expect(diff.sections).toEqual([]);
    expect(diff.fields).toEqual([]);
  });

  it('detects metadata changes', () => {
    const before = base();
    const after = base({ name: 'Updated intake', status: 'published' });
    const diff = diffFormSchemas(before, after);

    expect(diff.metadata).toContainEqual({ kind: 'changed', path: 'name', before: 'Specimen intake', after: 'Updated intake' });
    expect(diff.metadata).toContainEqual({ kind: 'changed', path: 'status', before: 'draft', after: 'published' });
  });

  it('detects added and removed sections', () => {
    const before = base({ sections: [{ id: 's1', label: 'S1', order: 0 }] });
    const after = base({ sections: [{ id: 's2', label: 'S2', order: 0 }] });
    const diff = diffFormSchemas(before, after);

    expect(diff.sections).toContainEqual(expect.objectContaining({ kind: 'removed', sectionId: 's1' }));
    expect(diff.sections).toContainEqual(expect.objectContaining({ kind: 'added', sectionId: 's2' }));
  });

  it('detects section label change', () => {
    const before = base({ sections: [{ id: 's1', label: 'Old label', order: 0 }] });
    const after = base({ sections: [{ id: 's1', label: 'New label', order: 0 }] });
    const diff = diffFormSchemas(before, after);

    expect(diff.sections).toContainEqual({ kind: 'changed', sectionId: 's1', path: 'label', before: 'Old label', after: 'New label' });
  });

  it('detects added, removed, and changed fields', () => {
    const before = base({
      fields: [
        makeField({ id: 'sample-id', displayLabel: 'Sample id', fieldType: 'text', order: 0 }),
        makeField({ id: 'received', displayLabel: 'Received', fieldType: 'date', order: 1 }),
      ],
    });
    const after = base({
      fields: [
        makeField({ id: 'sample-id', displayLabel: 'Sample id', fieldType: 'identifier', order: 0 }), // fieldType changed
        makeField({ id: 'collector', displayLabel: 'Collector', fieldType: 'text', order: 1 }),    // added
        // received removed
      ],
    });
    const diff = diffFormSchemas(before, after);

    expect(diff.fields).toContainEqual(expect.objectContaining({ kind: 'changed', fieldId: 'sample-id', path: 'fieldType' }));
    expect(diff.fields).toContainEqual(expect.objectContaining({ kind: 'removed', fieldId: 'received' }));
    expect(diff.fields).toContainEqual(expect.objectContaining({ kind: 'added', fieldId: 'collector' }));
  });

  it('groups metadata/sections/fields in the diff object', () => {
    const diff = diffFormSchemas(base(), base({ name: 'New name' }));
    expect(diff).toHaveProperty('metadata');
    expect(diff).toHaveProperty('sections');
    expect(diff).toHaveProperty('fields');
  });
});
