import { describe, it, expect } from 'vitest'
import type { Extension } from 'fhir/r4'
import type { BindingStrength } from './schema/form-schema'
import { toBindingStrengthExtension, fromBindingStrengthExtension } from './binding-strength'
import { EXT_CORLIX_BINDING_STRENGTH } from './extensions'

describe('toBindingStrengthExtension', () => {
  it('emits a valueString extension for each valid strength', () => {
    const strengths: BindingStrength[] = ['required', 'extensible', 'preferred', 'example']
    for (const s of strengths) {
      const ext = toBindingStrengthExtension(s)
      expect(ext).toEqual({ url: EXT_CORLIX_BINDING_STRENGTH, valueString: s })
    }
  })

  it('returns undefined when strength is undefined', () => {
    expect(toBindingStrengthExtension(undefined)).toBeUndefined()
  })
})

describe('fromBindingStrengthExtension', () => {
  it('recovers required strength from extensions', () => {
    const extensions: Extension[] = [{ url: EXT_CORLIX_BINDING_STRENGTH, valueString: 'required' }]
    expect(fromBindingStrengthExtension(extensions)).toBe('required')
  })

  it('recovers all valid strengths', () => {
    const strengths: BindingStrength[] = ['required', 'extensible', 'preferred', 'example']
    for (const s of strengths) {
      const extensions: Extension[] = [{ url: EXT_CORLIX_BINDING_STRENGTH, valueString: s }]
      expect(fromBindingStrengthExtension(extensions)).toBe(s)
    }
  })

  it('returns undefined when extension is absent', () => {
    expect(fromBindingStrengthExtension([])).toBeUndefined()
    expect(fromBindingStrengthExtension(undefined)).toBeUndefined()
  })

  it('drops an out-of-vocabulary strength value', () => {
    const extensions: Extension[] = [{ url: EXT_CORLIX_BINDING_STRENGTH, valueString: 'strict' }]
    expect(fromBindingStrengthExtension(extensions)).toBeUndefined()
  })

  it('ignores unrelated extensions', () => {
    const extensions: Extension[] = [
      { url: 'urn:corlix:questionnaire:field-type', valueString: 'select' },
      { url: EXT_CORLIX_BINDING_STRENGTH, valueString: 'extensible' },
    ]
    expect(fromBindingStrengthExtension(extensions)).toBe('extensible')
  })
})

describe('round-trip — BindingStrength ↔ FHIR Extension', () => {
  it('is stable for all four canonical strengths', () => {
    const strengths: BindingStrength[] = ['required', 'extensible', 'preferred', 'example']
    for (const s of strengths) {
      const ext = toBindingStrengthExtension(s)
      expect(fromBindingStrengthExtension(ext ? [ext] : [])).toBe(s)
    }
  })
})
