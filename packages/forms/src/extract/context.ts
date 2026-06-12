import type { FhirResource } from '@openldr/fhir';

export interface ExtractionContext {
  subject?: { reference: string };
  authored?: string;
}

export interface ExtractionResult {
  resources: FhirResource[];
  invalid: { resource: FhirResource; outcome: unknown }[];
}
