import { describe, expect, it } from 'vitest';
import { createDefaultFormSchema, newField, newSection, reindexFields } from './builderModel';

describe('builderModel', () => {
  it('creates a runnable default form schema', () => {
    const schema = createDefaultFormSchema('Specimen intake');
    expect(schema.name).toBe('Specimen intake');
    expect(schema.languages).toEqual(['en']);
    expect(schema.sections[0].fields).toHaveLength(0);
  });

  it('creates fields and sections with stable ids', () => {
    expect(newSection('Patient details').id).toBe('patient-details');
    expect(newField('Patient ID', 'string').id).toBe('patient-id');
  });

  it('reindexes fields without changing their content', () => {
    const fields = [newField('B', 'string'), newField('A', 'date')];
    expect(reindexFields(fields)).toEqual(fields);
  });
});
