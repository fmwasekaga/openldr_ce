import type { Bundle, FhirResource } from '@openldr/fhir';

export function toTransactionBundle(resources: FhirResource[]): Bundle {
  return {
    resourceType: 'Bundle',
    type: 'transaction',
    entry: resources.map((r) => ({ resource: r, request: { method: 'POST', url: r.resourceType } })),
  } as Bundle;
}
