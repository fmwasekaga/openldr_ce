import type { Element, Extension } from 'fhir/r4'
import { EXT_TRANSLATION } from './extensions'

/** Build standard `translation` extensions from a locale → text map. */
export function translationExtensions(map: Record<string, string>): Extension[] {
  return Object.entries(map).map(([lang, content]) => ({
    url: EXT_TRANSLATION,
    extension: [
      { url: 'lang', valueCode: lang },
      { url: 'content', valueString: content },
    ],
  }))
}

/** Read a locale → text map back from an element's `translation` extensions. */
export function parseTranslations(element: Element | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const ext of element?.extension ?? []) {
    if (ext.url !== EXT_TRANSLATION) continue
    const lang = ext.extension?.find((e) => e.url === 'lang')?.valueCode
    const content = ext.extension?.find((e) => e.url === 'content')?.valueString
    if (lang && content !== undefined) out[lang] = content
  }
  return out
}

/** A primitive `_element` carrying translation extensions, or undefined when the map is empty. */
export function translationElement(map: Record<string, string>): Element | undefined {
  return Object.keys(map).length ? { extension: translationExtensions(map) } : undefined
}

export function hasKeys(map: Record<string, unknown>): boolean {
  return Object.keys(map).length > 0
}
