import { describe, it, expect } from 'vitest'
import { toQuestionnaire } from './to-questionnaire'
import { toQuestionnaireResponse } from './response'
import { fromQuestionnaireResponse } from './from-response'
import { makeField, makeSchema } from './__fixtures__/forms'

describe('toQuestionnaireResponse — shape', () => {
  it('is a completed QuestionnaireResponse with linkId-keyed answer items', () => {
    const model = makeSchema({ id: 'f', name: 'F', fields: [makeField({ id: 'name', displayLabel: 'Name', fieldType: 'text', order: 0 })] })
    const qr = toQuestionnaireResponse(model, { name: 'Jane' })
    expect(qr.resourceType).toBe('QuestionnaireResponse')
    expect(qr.status).toBe('completed')
    expect(qr.item?.[0]).toMatchObject({ linkId: 'name', answer: [{ valueString: 'Jane' }] })
  })

  it('omits items with no answer', () => {
    const model = makeSchema({ id: 'f', name: 'F', fields: [makeField({ id: 'name', displayLabel: 'Name', fieldType: 'text', order: 0 })] })
    expect(toQuestionnaireResponse(model, {}).item ?? []).toHaveLength(0)
  })
})

describe('capture round-trip — fromQuestionnaireResponse(toQuestionnaireResponse(...))', () => {
  const roundTrip = (model: ReturnType<typeof makeSchema>, answers: Record<string, unknown>) =>
    fromQuestionnaireResponse(toQuestionnaireResponse(model, answers), toQuestionnaire(model))

  it('round-trips scalar answers of each type', () => {
    const model = makeSchema({
      id: 'f', name: 'F',
      fields: [
        makeField({ id: 'name', displayLabel: 'Name', fieldType: 'text', order: 0 }),
        makeField({ id: 'age', displayLabel: 'Age', fieldType: 'number', order: 1 }),
        makeField({ id: 'ok', displayLabel: 'OK', fieldType: 'boolean', order: 2 }),
        makeField({ id: 'dob', displayLabel: 'DOB', fieldType: 'date', order: 3 }),
        makeField({ id: 'sex', displayLabel: 'Sex', fieldType: 'select', order: 4, valueSetOptions: [{ code: 'M', display: 'Male' }] }),
      ],
    })
    const answers = { name: 'Jane', age: 30, ok: true, dob: '1994-01-02', sex: 'M' }
    expect(roundTrip(model, answers)).toEqual(answers)
  })

  it('round-trips a repeatable scalar (multiple answers)', () => {
    const model = makeSchema({ id: 'f', name: 'F', fields: [makeField({ id: 'phones', displayLabel: 'Phones', fieldType: 'phone', order: 0, repeatable: true })] })
    expect(roundTrip(model, { phones: ['111', '222', '333'] })).toEqual({ phones: ['111', '222', '333'] })
  })

  it('round-trips a multiselect (array of codes)', () => {
    const model = makeSchema({ id: 'f', name: 'F', fields: [makeField({ id: 'sx', displayLabel: 'Symptoms', fieldType: 'multiselect', order: 0 })] })
    expect(roundTrip(model, { sx: ['fever', 'cough'] })).toEqual({ sx: ['fever', 'cough'] })
  })

  it('round-trips a repeating group with per-instance child values', () => {
    const model = makeSchema({
      id: 'f', name: 'F',
      fields: [
        makeField({ id: 'contacts', displayLabel: 'Contacts', fieldType: 'group', order: 0, minItems: 1 }),
        makeField({ id: 'cname', displayLabel: 'Name', fieldType: 'text', order: 1, groupId: 'contacts' }),
        makeField({ id: 'cphone', displayLabel: 'Phone', fieldType: 'phone', order: 2, groupId: 'contacts' }),
      ],
    })
    const answers = { contacts: [{ cname: 'Ann', cphone: '111' }, { cname: 'Bob', cphone: '222' }] }
    expect(roundTrip(model, answers)).toEqual(answers)
  })

  it('round-trips answers inside a section', () => {
    const model = makeSchema({
      id: 'f', name: 'F',
      sections: [{ id: 's1', label: 'Demographics', order: 0 }],
      fields: [makeField({ id: 'name', displayLabel: 'Name', fieldType: 'text', order: 0, section: 's1' })],
    })
    expect(roundTrip(model, { name: 'Jane' })).toEqual({ name: 'Jane' })
  })
})
