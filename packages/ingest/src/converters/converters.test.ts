import { describe, it, expect } from 'vitest';
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
  it('extracts resources from { questionnaire, response }', async () => {
    const questionnaire = {
      resourceType: 'Questionnaire',
      status: 'active',
      extension: [{ url: 'https://openldr.org/fhir/StructureDefinition/form', valueString: JSON.stringify({ id: 'f', name: 'f', title: { en: 'F' }, status: 'active', languages: ['en'] }) }],
      item: [
        {
          linkId: 'demo',
          type: 'group',
          extension: [{ url: 'https://openldr.org/fhir/StructureDefinition/form-section', valueString: JSON.stringify({ id: 'demo', title: { en: 'D' }, resourceType: 'Patient' }) }],
          item: [
            { linkId: 'sex', type: 'choice', extension: [{ url: 'https://openldr.org/fhir/StructureDefinition/form-field', valueString: JSON.stringify({ id: 'sex', type: 'choice', label: { en: 'Sex' }, fhirPath: 'gender', options: [{ code: 'female', display: { en: 'F' } }] }) }] },
          ],
        },
      ],
    };
    const response = { resourceType: 'QuestionnaireResponse', status: 'completed', item: [{ linkId: 'demo', item: [{ linkId: 'sex', answer: [{ valueCoding: { code: 'female' } }] }] }] };
    const out = await questionnaireResponseConverter.convert(enc({ questionnaire, response }), ctx);
    expect(out.some((r) => r.resourceType === 'Patient')).toBe(true);
  });
});

describe('defaultConverters', () => {
  it('registers both built-ins', () => {
    expect(defaultConverters().list()).toEqual(['fhir-bundle', 'questionnaire-response']);
  });
});
