import type { FhirResource } from '@openldr/fhir';
import type { Converter } from '../converter';

const decoder = new TextDecoder();

export const fhirBundleConverter: Converter = {
  id: 'fhir-bundle',
  version: '1',
  async convert(raw) {
    const data = JSON.parse(decoder.decode(raw)) as Record<string, unknown>;
    if (data.resourceType === 'Bundle') {
      const entry = (data.entry as Array<{ resource?: FhirResource }> | undefined) ?? [];
      return entry.map((e) => e.resource).filter((r): r is FhirResource => Boolean(r));
    }
    if (typeof data.resourceType === 'string') return [data as FhirResource];
    throw new Error('payload is not a FHIR Bundle or resource');
  },
};
