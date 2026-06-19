import { describe, expect, it } from 'vitest'
import type { FieldType } from './schema/form-schema'
import {
  nativeItemType,
  fieldTypeNeedsHint,
  toQStatus,
  fromQStatus,
  reverseFieldType,
} from './scalar-types'

describe('nativeItemType', () => {
  it('maps scalar field types to FHIR item.type', () => {
    const cases: Array<[FieldType, string]> = [
      ['text', 'string'],
      ['phone', 'string'],
      ['email', 'string'],
      ['identifier', 'string'],
      ['number', 'decimal'],
      ['date', 'date'],
      ['datetime', 'dateTime'],
      ['boolean', 'boolean'],
      ['select', 'choice'],
      ['multiselect', 'choice'],
    ]
    for (const [fieldType, expected] of cases) {
      expect(nativeItemType(fieldType), fieldType).toBe(expected)
    }
  })

  it('falls back to string for unmapped field types', () => {
    const unmapped: FieldType[] = [
      'address',
      'attachment',
      'organism',
      'antibiogram',
      'reference',
      'facility',
      'group',
    ]
    for (const fieldType of unmapped) {
      expect(nativeItemType(fieldType), fieldType).toBe('string')
    }
  })
})

describe('reverseFieldType', () => {
  it('maps FHIR item.type back to the default field type', () => {
    expect(reverseFieldType('string')).toBe('text')
    expect(reverseFieldType('text')).toBe('text')
    expect(reverseFieldType('decimal')).toBe('number')
    expect(reverseFieldType('integer')).toBe('number')
    expect(reverseFieldType('date')).toBe('date')
    expect(reverseFieldType('dateTime')).toBe('datetime')
    expect(reverseFieldType('boolean')).toBe('boolean')
    expect(reverseFieldType('choice')).toBe('select')
    expect(reverseFieldType('open-choice')).toBe('select')
  })

  it('falls back to text for unknown item types', () => {
    expect(reverseFieldType('quantity')).toBe('text')
    expect(reverseFieldType('reference')).toBe('text')
  })
})

describe('fieldTypeNeedsHint', () => {
  it('returns false for field types that round-trip losslessly', () => {
    // These have a unique native mapping that reverses back unambiguously
    expect(fieldTypeNeedsHint('date')).toBe(false)
    expect(fieldTypeNeedsHint('datetime')).toBe(false)
    expect(fieldTypeNeedsHint('boolean')).toBe(false)
    expect(fieldTypeNeedsHint('select')).toBe(false)
  })

  it('returns true for field types that share a native type and need a hint extension', () => {
    // phone → string → text (not phone), so needs hint
    expect(fieldTypeNeedsHint('phone')).toBe(true)
    // email → string → text (not email), so needs hint
    expect(fieldTypeNeedsHint('email')).toBe(true)
    // identifier → string → text (not identifier), so needs hint
    expect(fieldTypeNeedsHint('identifier')).toBe(true)
    // multiselect → choice → select (not multiselect), so needs hint
    expect(fieldTypeNeedsHint('multiselect')).toBe(true)
    // text → string → text: no hint needed
    expect(fieldTypeNeedsHint('text')).toBe(false)
    // number → decimal → number: no hint needed
    expect(fieldTypeNeedsHint('number')).toBe(false)
    // unmapped types → string → text (not the original type), so need hint
    expect(fieldTypeNeedsHint('address')).toBe(true)
    expect(fieldTypeNeedsHint('attachment')).toBe(true)
    expect(fieldTypeNeedsHint('organism')).toBe(true)
    expect(fieldTypeNeedsHint('antibiogram')).toBe(true)
    expect(fieldTypeNeedsHint('reference')).toBe(true)
    expect(fieldTypeNeedsHint('facility')).toBe(true)
    expect(fieldTypeNeedsHint('group')).toBe(true)
  })
})

describe('toQStatus', () => {
  it('maps form status to FHIR questionnaire status', () => {
    expect(toQStatus('draft')).toBe('draft')
    expect(toQStatus('published')).toBe('active')
    expect(toQStatus('archived')).toBe('retired')
  })
})

describe('fromQStatus', () => {
  it('maps FHIR questionnaire status to form status', () => {
    expect(fromQStatus('draft')).toBe('draft')
    expect(fromQStatus('active')).toBe('published')
    expect(fromQStatus('retired')).toBe('archived')
  })

  it('falls back to draft for unknown statuses', () => {
    expect(fromQStatus('unknown' as never)).toBe('draft')
  })
})
