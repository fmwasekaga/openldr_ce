import { describe, it, expect } from 'vitest'
import type { Coding } from 'fhir/r4'
import type { FormFieldCoding } from './schema/form-schema'
import { toFhirCoding, fromFhirCoding, toFhirCodings, fromFhirCodings } from './coding'

describe('toFhirCoding', () => {
  it('maps system, code, and display', () => {
    const input: FormFieldCoding = { system: 'http://loinc.org', code: '718-7', display: 'Hemoglobin' }
    expect(toFhirCoding(input)).toEqual({ system: 'http://loinc.org', code: '718-7', display: 'Hemoglobin' })
  })

  it('omits display when absent', () => {
    const input: FormFieldCoding = { system: 'http://loinc.org', code: '718-7' }
    const result = toFhirCoding(input)
    expect(result).toEqual({ system: 'http://loinc.org', code: '718-7' })
    expect(result).not.toHaveProperty('display')
  })
})

describe('fromFhirCoding', () => {
  it('maps system, code, and display', () => {
    const input: Coding = { system: 'http://loinc.org', code: '718-7', display: 'Hemoglobin' }
    expect(fromFhirCoding(input)).toEqual({ system: 'http://loinc.org', code: '718-7', display: 'Hemoglobin' })
  })

  it('defaults missing system and code to empty string', () => {
    const result = fromFhirCoding({})
    expect(result.system).toBe('')
    expect(result.code).toBe('')
  })

  it('omits display when absent', () => {
    const result = fromFhirCoding({ system: 'http://loinc.org', code: '718-7' })
    expect(result).not.toHaveProperty('display')
  })
})

describe('toFhirCodings', () => {
  it('maps an array of FormFieldCoding values', () => {
    const input: FormFieldCoding[] = [
      { system: 'http://loinc.org', code: '718-7', display: 'Hemoglobin' },
      { system: 'http://snomed.info/sct', code: '38082009' },
    ]
    expect(toFhirCodings(input)).toEqual([
      { system: 'http://loinc.org', code: '718-7', display: 'Hemoglobin' },
      { system: 'http://snomed.info/sct', code: '38082009' },
    ])
  })

  it('returns undefined for empty array', () => {
    expect(toFhirCodings([])).toBeUndefined()
  })

  it('returns undefined for undefined input', () => {
    expect(toFhirCodings(undefined)).toBeUndefined()
  })
})

describe('fromFhirCodings', () => {
  it('maps an array of FHIR Coding values', () => {
    const input: Coding[] = [
      { system: 'http://loinc.org', code: '718-7', display: 'Hemoglobin' },
    ]
    expect(fromFhirCodings(input)).toEqual([
      { system: 'http://loinc.org', code: '718-7', display: 'Hemoglobin' },
    ])
  })

  it('returns undefined for empty array', () => {
    expect(fromFhirCodings([])).toBeUndefined()
  })

  it('returns undefined for undefined input', () => {
    expect(fromFhirCodings(undefined)).toBeUndefined()
  })
})

describe('round-trip — FormFieldCoding ↔ FHIR Coding', () => {
  it('is stable with display', () => {
    const original: FormFieldCoding = { system: 'http://loinc.org', code: '718-7', display: 'Hemoglobin' }
    expect(fromFhirCoding(toFhirCoding(original))).toEqual(original)
  })

  it('is stable without display', () => {
    const original: FormFieldCoding = { system: 'http://loinc.org', code: '718-7' }
    expect(fromFhirCoding(toFhirCoding(original))).toEqual(original)
  })
})
