/**
 * coding.ts — FormFieldCoding ↔ FHIR Coding conversion helpers.
 *
 * Extracted from the toQuestionnaire / fromQuestionnaire adapters so that
 * other modules (e.g. answer-value, extract) can reuse them without importing
 * the full adapter chain.
 */
import type { Coding } from 'fhir/r4'
import type { FormFieldCoding } from './schema/form-schema'

/**
 * Convert a `FormFieldCoding` to a FHIR R4 `Coding`.
 * `display` is omitted when absent to keep the output minimal.
 */
export function toFhirCoding(c: FormFieldCoding): Coding {
  return {
    system: c.system,
    code: c.code,
    ...(c.display ? { display: c.display } : {}),
  }
}

/**
 * Convert a FHIR R4 `Coding` to a `FormFieldCoding`.
 * Missing `system` / `code` default to empty string (defensive — well-formed
 * Questionnaire items always carry them).
 */
export function fromFhirCoding(c: Coding): FormFieldCoding {
  return {
    system: c.system ?? '',
    code: c.code ?? '',
    ...(c.display ? { display: c.display } : {}),
  }
}

/**
 * Map an array of `FormFieldCoding` values to FHIR `Coding[]`.
 * Returns `undefined` when the input is empty or absent so callers can
 * use `if (x) item.code = x` without extra guards.
 */
export function toFhirCodings(
  codes: FormFieldCoding[] | undefined,
): Coding[] | undefined {
  if (!codes?.length) return undefined
  return codes.map(toFhirCoding)
}

/**
 * Map an array of FHIR `Coding` values back to `FormFieldCoding[]`.
 * Returns `undefined` when the input is empty or absent.
 */
export function fromFhirCodings(
  codes: Coding[] | undefined,
): FormFieldCoding[] | undefined {
  if (!codes?.length) return undefined
  return codes.map(fromFhirCoding)
}
