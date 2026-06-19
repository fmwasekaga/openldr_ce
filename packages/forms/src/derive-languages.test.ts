import { describe, it, expect } from 'vitest'
import { deriveLanguagesFromTranslations } from './derive-languages'
import { makeField } from './__fixtures__/forms'

describe('deriveLanguagesFromTranslations', () => {
  it('unions field label/description locales and option locales, sorted', () => {
    const fields = [
      makeField({ id: 'a', displayLabel: 'Name', fieldType: 'text', order: 0, translations: { pt: { label: 'Nome' }, fr: { description: 'x' } } }),
      makeField({ id: 's', displayLabel: 'Sex', fieldType: 'select', order: 1, valueSetOptions: [{ code: 'M', display: 'Male', translations: { sw: 'Mwanaume' } }] }),
    ]
    expect(deriveLanguagesFromTranslations(fields)).toEqual(['fr', 'pt', 'sw'])
  })

  it('returns an empty array when no translations exist', () => {
    expect(deriveLanguagesFromTranslations([makeField({ id: 'a', displayLabel: 'A', fieldType: 'text', order: 0 })])).toEqual([])
  })
})
