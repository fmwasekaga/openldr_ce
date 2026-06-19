import type { FormField } from './schema/form-schema'

/**
 * Union of locale codes used across a field list's label/description and option
 * translations, stable-sorted. Recovers a form's `languages` when no explicit
 * declaration is stored (legacy forms predating EXT_CORLIX_LANGUAGES).
 */
export function deriveLanguagesFromTranslations(fields: FormField[]): string[] {
  const locales = new Set<string>()
  for (const field of fields) {
    for (const locale of Object.keys(field.translations ?? {})) locales.add(locale)
    for (const opt of field.valueSetOptions ?? []) {
      for (const locale of Object.keys(opt.translations ?? {})) locales.add(locale)
    }
  }
  return [...locales].sort()
}
