import { describe, it, expect } from 'vitest'
import type { QuestionnaireItem } from 'fhir/r4'
import { toQuestionnaire } from './to-questionnaire'
import { fromQuestionnaire } from './from-questionnaire'
import { makeField, makeSchema, definitionOf } from './__fixtures__/forms'
import {
  EXT_QUESTIONNAIRE_MIN_OCCURS,
  EXT_QUESTIONNAIRE_MAX_OCCURS,
  EXT_CORLIX_SECTION,
} from './extensions'

const ext = (item: QuestionnaireItem, url: string) => item.extension?.find((e) => e.url === url)

describe('toQuestionnaire — repeatable scalar', () => {
  it('marks repeats and carries minItems/maxItems as min/maxOccurs', () => {
    const q = toQuestionnaire(
      makeSchema({
        id: 'f',
        name: 'F',
        fields: [makeField({ id: 'x', displayLabel: 'X', fieldType: 'text', order: 0, repeatable: true, minItems: 1, maxItems: 5 })],
      }),
    )
    const item = q.item![0]
    expect(item.repeats).toBe(true)
    expect(ext(item, EXT_QUESTIONNAIRE_MIN_OCCURS)?.valueInteger).toBe(1)
    expect(ext(item, EXT_QUESTIONNAIRE_MAX_OCCURS)?.valueInteger).toBe(5)
  })
})

describe('toQuestionnaire — group', () => {
  it('nests group children, always repeats, carries the instance floor', () => {
    const q = toQuestionnaire(
      makeSchema({
        id: 'f',
        name: 'F',
        fields: [
          makeField({ id: 'g', displayLabel: 'Contacts', fieldType: 'group', order: 0, minItems: 1 }),
          makeField({ id: 'c1', displayLabel: 'Name', fieldType: 'text', order: 1, groupId: 'g' }),
          makeField({ id: 'c2', displayLabel: 'Phone', fieldType: 'phone', order: 2, groupId: 'g' }),
        ],
      }),
    )
    expect(q.item).toHaveLength(1)
    const group = q.item![0]
    expect(group.type).toBe('group')
    expect(group.repeats).toBe(true)
    expect(ext(group, EXT_QUESTIONNAIRE_MIN_OCCURS)?.valueInteger).toBe(1)
    expect(group.item?.map((i) => i.linkId)).toEqual(['c1', 'c2'])
  })
})

describe('toQuestionnaire — sections', () => {
  it('emits a section as a marked group item holding its fields', () => {
    const q = toQuestionnaire(
      makeSchema({
        id: 'f',
        name: 'F',
        sections: [{ id: 's1', label: 'Demographics', order: 0 }],
        fields: [makeField({ id: 'a', displayLabel: 'Name', fieldType: 'text', order: 0, section: 's1' })],
      }),
    )
    expect(q.item).toHaveLength(1)
    const sec = q.item![0]
    expect(sec.type).toBe('group')
    expect(sec.linkId).toBe('s1')
    expect(sec.text).toBe('Demographics')
    expect(ext(sec, EXT_CORLIX_SECTION)?.valueBoolean).toBe(true)
    expect(sec.item?.map((i) => i.linkId)).toEqual(['a'])
  })
})

describe('round-trip — structural', () => {
  it('is stable with sections, a repeating group, and a repeatable field', () => {
    const model = makeSchema({
      id: 'form',
      name: 'Requisition',
      status: 'published',
      sections: [
        { id: 's1', label: 'Patient', order: 0 },
        { id: 's2', label: 'Tests', order: 1, fhirResourceType: 'ServiceRequest' },
      ],
      fields: [
        makeField({ id: 'name', displayLabel: 'Name', fieldType: 'text', order: 0, section: 's1', required: true }),
        makeField({ id: 'g', displayLabel: 'Specimens', fieldType: 'group', order: 1, section: 's2', minItems: 1, maxItems: 3 }),
        makeField({ id: 'gc1', displayLabel: 'Type', fieldType: 'text', order: 2, groupId: 'g' }),
        makeField({ id: 'gc2', displayLabel: 'Volume', fieldType: 'number', order: 3, groupId: 'g' }),
        makeField({ id: 'notes', displayLabel: 'Notes', fieldType: 'text', order: 4, repeatable: true, minItems: 0, maxItems: 5 }),
      ],
    })
    expect(definitionOf(fromQuestionnaire(toQuestionnaire(model)))).toEqual(definitionOf(model))
  })
})
