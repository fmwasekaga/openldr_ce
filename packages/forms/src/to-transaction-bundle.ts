import type { Bundle, BundleEntry, FhirResource, QuestionnaireResponse } from 'fhir/r4'

/**
 * Package a QuestionnaireResponse and its extracted resources into a single FHIR
 * `transaction` Bundle (PRD §3.2) — Bundle's real job, at submission time. Each
 * entry POSTs to its resource type.
 */
export function toTransactionBundle(response: QuestionnaireResponse, extracted: FhirResource[]): Bundle {
  const entry: BundleEntry[] = [
    { resource: response, request: { method: 'POST', url: 'QuestionnaireResponse' } },
    ...extracted.map((resource) => ({
      resource,
      request: { method: 'POST' as const, url: resource.resourceType },
    })),
  ]
  return { resourceType: 'Bundle', type: 'transaction', entry }
}
