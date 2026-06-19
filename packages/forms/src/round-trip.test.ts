import { describe, it, expect } from 'vitest'
import { toQuestionnaire } from './to-questionnaire'
import { fromQuestionnaire } from './from-questionnaire'
import { makeField, makeSchema, definitionOf } from './__fixtures__/forms'

describe('round-trip: fromQuestionnaire(toQuestionnaire(m))', () => {
  it('is stable for a schema of scalar fields', () => {
    const model = makeSchema({
      id: 'form-1',
      name: 'Patient intake',
      status: 'published',
      fhirVersion: '4.0.1',
      fhirResourceType: 'Patient',
      fhirProfileUrl: 'http://example.org/StructureDefinition/Patient',
      fields: [
        makeField({ id: 'a', displayLabel: 'Full name', fieldType: 'text', order: 0, required: true, fhirPath: 'Patient.name', description: 'Legal name' }),
        makeField({ id: 'b', displayLabel: 'Age', fieldType: 'number', order: 1 }),
        makeField({ id: 'c', displayLabel: 'DOB', fieldType: 'date', order: 2 }),
        makeField({ id: 'd', displayLabel: 'Visit time', fieldType: 'datetime', order: 3 }),
        makeField({ id: 'e', displayLabel: 'Consent', fieldType: 'boolean', order: 4, required: true }),
        makeField({ id: 'p', displayLabel: 'Phone', fieldType: 'phone', order: 5 }),
        makeField({ id: 'm', displayLabel: 'Email', fieldType: 'email', order: 6 }),
        makeField({ id: 'n', displayLabel: 'MRN', fieldType: 'identifier', order: 7 }),
      ],
    })
    const round = fromQuestionnaire(toQuestionnaire(model))
    expect(definitionOf(round)).toEqual(definitionOf(model))
  })

  it('preserves Corlix authoring metadata (apiProperty, discriminators, enabled)', () => {
    const model = makeSchema({
      id: 'f',
      name: 'F',
      fields: [
        makeField({ id: 'phone', displayLabel: 'Phone', fieldType: 'phone', order: 0, fhirPath: 'Patient.telecom', apiProperty: 'phone', fhirDiscriminator: { system: 'phone' }, fhirValueField: 'value', placeholder: '+255...' }),
        makeField({ id: 'email', displayLabel: 'Email', fieldType: 'email', order: 1, fhirPath: 'Patient.telecom', apiProperty: 'email', fhirDiscriminator: { system: 'email' }, fhirValueField: 'value', enabled: false }),
      ],
    })
    expect(definitionOf(fromQuestionnaire(toQuestionnaire(model)))).toEqual(definitionOf(model))
  })

  it('never mutates a linkId', () => {
    const model = makeSchema({
      id: 'f',
      name: 'F',
      fields: [makeField({ id: 'stable-id-xyz', displayLabel: 'X', fieldType: 'text', order: 0 })],
    })
    expect(fromQuestionnaire(toQuestionnaire(model)).fields.map((f) => f.id)).toEqual(['stable-id-xyz'])
  })
})
