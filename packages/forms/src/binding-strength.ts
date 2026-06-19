/**
 * binding-strength.ts — BindingStrength ↔ FHIR Extension conversion helpers.
 *
 * R4 Questionnaire has no native binding strength on `answerValueSet`; the
 * value is carried as a Corlix vendor extension (`EXT_CORLIX_BINDING_STRENGTH`).
 * Maps cleanly to R5 `answerConstraint` if/when the pin moves to R5.
 */
import type { Extension } from 'fhir/r4'
import type { BindingStrength } from './schema/form-schema'
import { EXT_CORLIX_BINDING_STRENGTH } from './extensions'

const VALID_BINDING_STRENGTHS = new Set<BindingStrength>([
  'required',
  'extensible',
  'preferred',
  'example',
])

/**
 * Serialize a `BindingStrength` to a FHIR `Extension`.
 * Returns `undefined` when `strength` is absent so callers can guard with
 * `if (x) ext.push(x)`.
 */
export function toBindingStrengthExtension(
  strength: BindingStrength | undefined,
): Extension | undefined {
  if (!strength) return undefined
  return { url: EXT_CORLIX_BINDING_STRENGTH, valueString: strength }
}

/**
 * Recover a `BindingStrength` from an array of FHIR extensions.
 * Returns `undefined` when the extension is absent or its value is not one
 * of the four canonical FHIR binding strengths (defensive against stale data).
 */
export function fromBindingStrengthExtension(
  extensions: Extension[] | undefined,
): BindingStrength | undefined {
  const value = extensions?.find((e) => e.url === EXT_CORLIX_BINDING_STRENGTH)
    ?.valueString
  if (!value || !VALID_BINDING_STRENGTHS.has(value as BindingStrength)) {
    return undefined
  }
  return value as BindingStrength
}
