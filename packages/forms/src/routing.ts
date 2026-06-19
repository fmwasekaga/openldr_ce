import type { FormSchema } from './schema/form-schema'
import { ObservationExtractor, ServiceRequestExtractor, type ResourceExtractor } from './extract/extract'

/** Form domains and who owns capture for each (PRD §3.1). */
export type FormDomain = 'requisition' | 'intake' | 'screening' | 'eqa' | 'result-entry' | 'instrument'
export type FormOwner = 'questionnaire' | 'test-engine'

const OWNER: Record<FormDomain, FormOwner> = {
  requisition: 'questionnaire',
  intake: 'questionnaire',
  screening: 'questionnaire',
  eqa: 'questionnaire',
  'result-entry': 'test-engine',
  instrument: 'test-engine',
}

export function formDomainOwner(domain: FormDomain): FormOwner {
  return OWNER[domain]
}

/** Infer a Questionnaire form's domain from its target resource type (heuristic, §3.1). */
export function domainForResourceType(resourceType: string | null): FormDomain {
  switch (resourceType) {
    case 'ServiceRequest':
      return 'requisition'
    case 'Patient':
    case 'RelatedPerson':
      return 'intake'
    case 'Observation':
    case 'Condition':
      return 'screening'
    default:
      return 'screening'
  }
}

/**
 * The extractors to run for a Questionnaire-owned form. v1: ObservationExtractor
 * always (a no-op unless fields are flagged observationExtract) plus
 * ServiceRequestExtractor for the requisition domain.
 */
export function extractorsForForm(model: FormSchema): ResourceExtractor[] {
  const extractors: ResourceExtractor[] = [ObservationExtractor]
  if (domainForResourceType(model.fhirResourceType) === 'requisition') {
    extractors.push(ServiceRequestExtractor)
  }
  return extractors
}
