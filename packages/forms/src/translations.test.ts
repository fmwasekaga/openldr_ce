import { describe, it, expect } from 'vitest'
import type { Element } from 'fhir/r4'
import { EXT_TRANSLATION } from './extensions'
import { translationExtensions, parseTranslations, translationElement, hasKeys } from './translations'

describe('translationExtensions', () => {
  it('builds one extension per locale with lang + content sub-extensions', () => {
    const exts = translationExtensions({ fr: 'Nom', pt: 'Nome' })
    expect(exts).toHaveLength(2)
    expect(exts[0].url).toBe(EXT_TRANSLATION)
    expect(exts[0].extension?.find((e) => e.url === 'lang')?.valueCode).toBe('fr')
    expect(exts[0].extension?.find((e) => e.url === 'content')?.valueString).toBe('Nom')
    expect(exts[1].extension?.find((e) => e.url === 'lang')?.valueCode).toBe('pt')
    expect(exts[1].extension?.find((e) => e.url === 'content')?.valueString).toBe('Nome')
  })

  it('returns an empty array for an empty map', () => {
    expect(translationExtensions({})).toEqual([])
  })
})

describe('parseTranslations', () => {
  it('reads locale → text back from translation extensions on an element', () => {
    const element: Element = {
      extension: [
        {
          url: EXT_TRANSLATION,
          extension: [
            { url: 'lang', valueCode: 'fr' },
            { url: 'content', valueString: 'Nom' },
          ],
        },
        {
          url: EXT_TRANSLATION,
          extension: [
            { url: 'lang', valueCode: 'pt' },
            { url: 'content', valueString: 'Nome' },
          ],
        },
      ],
    }
    expect(parseTranslations(element)).toEqual({ fr: 'Nom', pt: 'Nome' })
  })

  it('ignores extensions with a different URL', () => {
    const element: Element = {
      extension: [{ url: 'http://other.example/ext', extension: [{ url: 'lang', valueCode: 'fr' }] }],
    }
    expect(parseTranslations(element)).toEqual({})
  })

  it('returns an empty object for undefined input', () => {
    expect(parseTranslations(undefined)).toEqual({})
  })

  it('skips entries missing lang or content', () => {
    const element: Element = {
      extension: [
        { url: EXT_TRANSLATION, extension: [{ url: 'lang', valueCode: 'fr' }] },
        { url: EXT_TRANSLATION, extension: [{ url: 'content', valueString: 'Nome' }] },
      ],
    }
    expect(parseTranslations(element)).toEqual({})
  })
})

describe('translationElement', () => {
  it('returns an Element with extensions when the map is non-empty', () => {
    const el = translationElement({ fr: 'Nom' })
    expect(el).toBeDefined()
    expect(el?.extension).toHaveLength(1)
    expect(el?.extension?.[0].url).toBe(EXT_TRANSLATION)
  })

  it('returns undefined when the map is empty', () => {
    expect(translationElement({})).toBeUndefined()
  })
})

describe('hasKeys', () => {
  it('returns true when the object has at least one key', () => {
    expect(hasKeys({ a: 1 })).toBe(true)
  })

  it('returns false for an empty object', () => {
    expect(hasKeys({})).toBe(false)
  })
})

describe('round-trip: translationExtensions → parseTranslations', () => {
  it('is identity for a non-empty locale map', () => {
    const original = { fr: 'Nom', pt: 'Nome', sw: 'Jina' }
    const element: Element = { extension: translationExtensions(original) }
    expect(parseTranslations(element)).toEqual(original)
  })
})
