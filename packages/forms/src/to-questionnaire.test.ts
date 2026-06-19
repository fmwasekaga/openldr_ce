import { describe, it, expect } from 'vitest'
import { toQuestionnaire } from './to-questionnaire'
import { makeField, makeSchema } from './__fixtures__/forms'
import { EXT_CORLIX_FIELD_TYPE, EXT_CORLIX_FHIR_PATH } from './extensions'

describe('toQuestionnaire — schema level', () => {
  it('emits a Questionnaire with id and title', () => {
    const q = toQuestionnaire(makeSchema({ id: 'form-1', name: 'Intake' }))
    expect(q.resourceType).toBe('Questionnaire')
    expect(q.id).toBe('form-1')
    expect(q.title).toBe('Intake')
  })

  it.each([
    ['draft', 'draft'],
    ['published', 'active'],
    ['archived', 'retired'],
  ] as const)('maps FormStatus %s to Questionnaire.status %s', (formStatus, qStatus) => {
    const q = toQuestionnaire(makeSchema({ id: 'a', name: 'A', status: formStatus }))
    expect(q.status).toBe(qStatus)
  })
})

describe('toQuestionnaire — scalar items', () => {
  const schemaWith = (field: ReturnType<typeof makeField>) =>
    makeSchema({ id: 'f', name: 'F', fields: [field] })

  it('maps a required text field to a string item', () => {
    const q = toQuestionnaire(
      schemaWith(makeField({ id: 'name', displayLabel: 'Full name', fieldType: 'text', order: 0, required: true })),
    )
    expect(q.item).toHaveLength(1)
    const item = q.item![0]
    expect(item.linkId).toBe('name')
    expect(item.text).toBe('Full name')
    expect(item.type).toBe('string')
    expect(item.required).toBe(true)
  })

  it.each([
    ['number', 'decimal'],
    ['date', 'date'],
    ['datetime', 'dateTime'],
    ['boolean', 'boolean'],
  ] as const)('maps fieldType %s to item.type %s', (fieldType, itemType) => {
    const q = toQuestionnaire(schemaWith(makeField({ id: 'x', displayLabel: 'X', fieldType, order: 0 })))
    expect(q.item![0].type).toBe(itemType)
  })

  it.each(['phone', 'email', 'identifier'] as const)(
    'maps %s to a string item that records the original field type',
    (fieldType) => {
      const q = toQuestionnaire(schemaWith(makeField({ id: 'x', displayLabel: 'X', fieldType, order: 0 })))
      const item = q.item![0]
      expect(item.type).toBe('string')
      expect(item.extension?.find((e) => e.url === EXT_CORLIX_FIELD_TYPE)?.valueString).toBe(fieldType)
    },
  )

  it('omits the field-type extension for unambiguous types', () => {
    const q = toQuestionnaire(schemaWith(makeField({ id: 'x', displayLabel: 'X', fieldType: 'text', order: 0 })))
    expect(q.item![0].extension?.some((e) => e.url === EXT_CORLIX_FIELD_TYPE)).toBeFalsy()
  })

  it('carries fhirPath in a Corlix extension', () => {
    const q = toQuestionnaire(
      schemaWith(makeField({ id: 'ref', displayLabel: 'Ref', fieldType: 'text', order: 0, fhirPath: 'ServiceRequest.identifier' })),
    )
    expect(q.item![0].extension?.find((e) => e.url === EXT_CORLIX_FHIR_PATH)?.valueString).toBe(
      'ServiceRequest.identifier',
    )
  })

  it('orders items by FormField.order regardless of array order', () => {
    const q = toQuestionnaire(
      makeSchema({
        id: 'f',
        name: 'F',
        fields: [
          makeField({ id: 'second', displayLabel: 'Second', fieldType: 'text', order: 1 }),
          makeField({ id: 'first', displayLabel: 'First', fieldType: 'text', order: 0 }),
        ],
      }),
    )
    expect(q.item!.map((i) => i.linkId)).toEqual(['first', 'second'])
  })
})
