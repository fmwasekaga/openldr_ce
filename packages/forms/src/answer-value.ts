import type { FormField } from './schema/form-schema'
import type { QuestionnaireResponseItemAnswer } from 'fhir/r4'

/** Filled-in form values, keyed by field id (the app's `values` shape). */
export type AnswerState = Record<string, unknown>

const isEmpty = (v: unknown): boolean => v === undefined || v === null || v === ''

/** Encode a single scalar value as a QuestionnaireResponse answer, by field type. */
export function toAnswer(field: FormField, value: unknown): QuestionnaireResponseItemAnswer | null {
  if (isEmpty(value)) return null
  switch (field.fieldType) {
    case 'number':
      return { valueDecimal: Number(value) }
    case 'boolean':
      return { valueBoolean: Boolean(value) }
    case 'date':
      return { valueDate: String(value) }
    case 'datetime':
      return { valueDateTime: String(value) }
    case 'select':
    case 'multiselect':
      return { valueCoding: { code: String(value) } }
    case 'reference':
    case 'facility':
      return { valueReference: { reference: String(value) } }
    default:
      // text, phone, email, identifier, address, attachment, organism, antibiogram, group
      return { valueString: String(value) }
  }
}

/** Decode a QuestionnaireResponse answer back to a raw value (by which value[x] is present). */
export function fromAnswer(answer: QuestionnaireResponseItemAnswer): unknown {
  if (answer.valueDecimal !== undefined) return answer.valueDecimal
  if (answer.valueInteger !== undefined) return answer.valueInteger
  if (answer.valueBoolean !== undefined) return answer.valueBoolean
  if (answer.valueDate !== undefined) return answer.valueDate
  if (answer.valueDateTime !== undefined) return answer.valueDateTime
  if (answer.valueCoding !== undefined) return answer.valueCoding.code ?? ''
  if (answer.valueReference !== undefined) return answer.valueReference.reference
  if (answer.valueString !== undefined) return answer.valueString
  return undefined
}
