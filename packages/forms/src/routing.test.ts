import { describe, it, expect } from 'vitest'
import { formDomainOwner, domainForResourceType, extractorsForForm } from './routing'
import { ObservationExtractor, ServiceRequestExtractor } from './extract/extract'
import { makeSchema } from './__fixtures__/forms'

describe('domain ownership (§3.1)', () => {
  it.each([
    ['requisition', 'questionnaire'],
    ['intake', 'questionnaire'],
    ['screening', 'questionnaire'],
    ['eqa', 'questionnaire'],
    ['result-entry', 'test-engine'],
    ['instrument', 'test-engine'],
  ] as const)('%s is owned by %s', (domain, owner) => {
    expect(formDomainOwner(domain)).toBe(owner)
  })
})

describe('domainForResourceType', () => {
  it.each([
    ['ServiceRequest', 'requisition'],
    ['Patient', 'intake'],
    ['RelatedPerson', 'intake'],
    ['Observation', 'screening'],
    ['Condition', 'screening'],
    [null, 'screening'],
  ] as const)('%s -> %s', (rt, domain) => {
    expect(domainForResourceType(rt)).toBe(domain)
  })
})

describe('extractorsForForm', () => {
  it('runs Observation + ServiceRequest extractors for a requisition', () => {
    const extractors = extractorsForForm(makeSchema({ id: 'r', name: 'Req', fhirResourceType: 'ServiceRequest', fields: [] }))
    expect(extractors).toEqual([ObservationExtractor, ServiceRequestExtractor])
  })

  it('runs only the Observation extractor for a screening form', () => {
    const extractors = extractorsForForm(makeSchema({ id: 's', name: 'Scr', fhirResourceType: 'Observation', fields: [] }))
    expect(extractors).toEqual([ObservationExtractor])
  })
})
