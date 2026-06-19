import { describe, it, expect } from 'vitest'
import type { Questionnaire } from 'fhir/r4'
import { fromQuestionnaire } from './from-questionnaire'
import { EXT_CORLIX_FIELD_TYPE } from './extensions'

describe('fromQuestionnaire — parsing', () => {
  it('reconstructs schema identity and status', () => {
    const q: Questionnaire = {
      resourceType: 'Questionnaire',
      id: 'form-9',
      title: 'Screening',
      status: 'active',
    }
    const model = fromQuestionnaire(q)
    expect(model.id).toBe('form-9')
    expect(model.name).toBe('Screening')
    expect(model.status).toBe('published') // active → published
  })

  it('reconstructs a scalar field with defaults', () => {
    const q: Questionnaire = {
      resourceType: 'Questionnaire',
      id: 'f',
      title: 'F',
      status: 'draft',
      item: [{ linkId: 'a', text: 'Age', type: 'decimal' }],
    }
    const f = fromQuestionnaire(q).fields[0]
    expect(f.id).toBe('a')
    expect(f.displayLabel).toBe('Age')
    expect(f.fieldType).toBe('number') // decimal → number
    expect(f.required).toBe(false)
    expect(f.enabled).toBe(true)
    expect(f.order).toBe(0)
    expect(f.fhirPath).toBeNull()
    expect(f.cardinality).toEqual({ min: 0, max: '1' })
  })

  it('restores the original field type from the Corlix extension', () => {
    const q: Questionnaire = {
      resourceType: 'Questionnaire',
      id: 'f',
      title: 'F',
      status: 'draft',
      item: [
        {
          linkId: 'p',
          text: 'Phone',
          type: 'string',
          extension: [{ url: EXT_CORLIX_FIELD_TYPE, valueString: 'phone' }],
        },
      ],
    }
    expect(fromQuestionnaire(q).fields[0].fieldType).toBe('phone')
  })
})
