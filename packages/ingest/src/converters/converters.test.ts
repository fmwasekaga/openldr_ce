import { describe, it, expect } from 'vitest';
import { toQuestionnaire, toQuestionnaireResponse, type FormSchema } from '@openldr/forms';
import { fhirBundleConverter } from './fhir-bundle';
import { questionnaireResponseConverter } from './questionnaire-response';
import { defaultConverters } from '../default-converters';

const enc = (o: unknown) => new TextEncoder().encode(JSON.stringify(o));
const ctx = { batchId: 'b1' };

describe('fhir-bundle converter', () => {
  it('returns the resources of a Bundle', async () => {
    const out = await fhirBundleConverter.convert(
      enc({ resourceType: 'Bundle', type: 'collection', entry: [{ resource: { resourceType: 'Patient', id: 'p1' } }] }),
      ctx,
    );
    expect(out).toHaveLength(1);
    expect(out[0].resourceType).toBe('Patient');
  });
  it('wraps a single resource', async () => {
    const out = await fhirBundleConverter.convert(enc({ resourceType: 'Patient', id: 'p1' }), ctx);
    expect(out).toHaveLength(1);
  });
  it('throws on non-FHIR', async () => {
    await expect(fhirBundleConverter.convert(enc({ foo: 1 }), ctx)).rejects.toThrow();
  });
});

describe('questionnaire-response converter', () => {
  it('extracts clinical resources (Observation) from { questionnaire, response }', async () => {
    // New model: the converter runs the domain extractors over a Questionnaire that
    // carries the form metadata as extensions (built via the engine's toQuestionnaire).
    // A field flagged observationExtract yields an Observation.
    const model: FormSchema = {
      id: 'f', name: 'F', versionLabel: null, fhirVersion: null, fhirResourceType: null, fhirProfileUrl: null, facilityId: null,
      fields: [{ id: 'hgb', fhirPath: null, displayLabel: 'Hgb', description: null, fieldType: 'number', required: false, enabled: true, order: 0, cardinality: { min: 0, max: '1' }, observationExtract: true, code: [{ system: 'http://loinc.org', code: '718-7' }] }],
      sections: [], targetPages: [], version: 1, active: true, status: 'draft', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const questionnaire = toQuestionnaire(model);
    const response = toQuestionnaireResponse(model, { hgb: 12.5 });
    const out = await questionnaireResponseConverter.convert(enc({ questionnaire, response }), ctx);
    expect(out.some((r) => r.resourceType === 'Observation')).toBe(true);
  });
});

describe('defaultConverters', () => {
  it('registers both built-ins', () => {
    expect(defaultConverters().list()).toEqual(['fhir-bundle', 'questionnaire-response']);
  });
});
