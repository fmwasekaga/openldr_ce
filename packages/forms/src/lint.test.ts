import { describe, expect, it } from 'vitest';
import { lintFormSchema } from './lint';

describe('lintFormSchema', () => {
  it('reports duplicate ids, duplicate FHIR paths, invalid choice configuration, extraction gaps, cardinality errors, and missing visibility controllers', () => {
    const issues = lintFormSchema({
      id: 'f',
      name: 'F',
      title: { en: 'F' },
      status: 'draft',
      languages: ['en'],
      sections: [
        {
          id: 'main',
          title: { en: 'Main' },
          fields: [
            { id: 'sample-id', type: 'string', label: { en: 'Sample id' }, fhirPath: 'Specimen.identifier.value' },
            { id: 'sample-id', type: 'string', label: { en: 'Duplicate sample id' }, fhirPath: 'Specimen.identifier.value' },
            { id: 'organism', type: 'choice', label: { en: 'Organism' } },
            { id: 'result', type: 'integer', label: { en: 'Result' }, observationExtract: true },
            { id: 'aliases', type: 'string', label: { en: 'Aliases' }, cardinality: { min: 3, max: 1 } },
            { id: 'followup', type: 'boolean', label: { en: 'Follow up' }, visibility: { whenField: 'missing', equals: true } },
          ],
        },
      ],
    });

    expect(issues.map((issue) => issue.code)).toEqual([
      'duplicate-id',
      'duplicate-fhir-path',
      'choice-missing-options',
      'observation-extract-missing-code',
      'cardinality-min-greater-than-max',
      'visibility-missing-field',
    ]);
    expect(issues.find((issue) => issue.code === 'duplicate-fhir-path')?.severity).toBe('warning');
    expect(issues.find((issue) => issue.code === 'visibility-missing-field')).toMatchObject({ fieldId: 'followup' });
  });

  it('does not report choices backed by a value set binding', () => {
    const issues = lintFormSchema({
      id: 'f',
      name: 'F',
      title: { en: 'F' },
      status: 'draft',
      languages: ['en'],
      sections: [
        { id: 'main', title: { en: 'Main' }, fields: [{ id: 'organism', type: 'choice', label: { en: 'Organism' }, valueSetBinding: { url: 'urn:test:organisms' } }] },
      ],
    });

    expect(issues).toEqual([]);
  });
});
