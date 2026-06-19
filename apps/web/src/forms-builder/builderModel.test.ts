import { describe, expect, it } from 'vitest';
import { createDefaultFormSchema, newField } from './builderModel';

describe('builderModel', () => {
  it('creates a default form schema with required fields', () => {
    const schema = createDefaultFormSchema('Specimen intake');
    expect(schema.name).toBe('Specimen intake');
    expect(schema.id).toBe('specimen-intake');
    expect(schema.status).toBe('draft');
    expect(schema.fields).toHaveLength(0);
    expect(schema.sections).toHaveLength(0);
    expect(schema.targetPages).toHaveLength(0);
    expect(schema.active).toBe(true);
    expect(schema.version).toBe(1);
    expect(typeof schema.createdAt).toBe('string');
  });

  it('creates a new field with correct defaults', () => {
    const field = newField('Patient ID', 'text');
    expect(field.id).toBe('patient-id');
    expect(field.displayLabel).toBe('Patient ID');
    expect(field.fieldType).toBe('text');
    expect(field.required).toBe(false);
    expect(field.enabled).toBe(true);
    expect(field.fhirPath).toBeNull();
    expect(field.description).toBeNull();
    expect(field.cardinality).toEqual({ min: 0, max: '1' });
  });

  it('generates slugified ids from display labels', () => {
    expect(newField('Date of Birth', 'date').id).toBe('date-of-birth');
    expect(newField('Lab Result Value', 'number').id).toBe('lab-result-value');
  });
});
