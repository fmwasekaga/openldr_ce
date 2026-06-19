import type { FieldType, FormStatus } from './schema/form-schema'
import type { Questionnaire, QuestionnaireItem } from 'fhir/r4'

type QItemType = QuestionnaireItem['type']
type QStatus = Questionnaire['status']

/**
 * FieldType → native `item.type`. Only the scalar subset has a meaningful
 * native type today; anything else falls back to `string` and is recovered
 * losslessly from the field-type extension (see `fieldTypeNeedsHint`).
 * Richer structural types (group, choice, …) get their real mapping in later
 * sub-tasks.
 */
const NATIVE_TYPE: Partial<Record<FieldType, QItemType>> = {
  text: 'string',
  phone: 'string',
  email: 'string',
  identifier: 'string',
  number: 'decimal',
  date: 'date',
  datetime: 'dateTime',
  boolean: 'boolean',
  select: 'choice',
  multiselect: 'choice',
}

/** `item.type` → default FieldType (the canonical inverse; ambiguous types default to the most common). */
const REVERSE_TYPE: Partial<Record<QItemType, FieldType>> = {
  string: 'text',
  text: 'text',
  decimal: 'number',
  integer: 'number',
  date: 'date',
  dateTime: 'datetime',
  boolean: 'boolean',
  choice: 'select',
  'open-choice': 'select',
}

export function nativeItemType(fieldType: FieldType): QItemType {
  return NATIVE_TYPE[fieldType] ?? 'string'
}

export function reverseFieldType(itemType: QItemType): FieldType {
  return REVERSE_TYPE[itemType] ?? 'text'
}

/** True when `item.type` alone cannot recover the FieldType, so it must be stamped in an extension. */
export function fieldTypeNeedsHint(fieldType: FieldType): boolean {
  return reverseFieldType(nativeItemType(fieldType)) !== fieldType
}

const FORM_TO_Q_STATUS: Record<FormStatus, QStatus> = {
  draft: 'draft',
  published: 'active',
  archived: 'retired',
}

const Q_TO_FORM_STATUS: Partial<Record<QStatus, FormStatus>> = {
  draft: 'draft',
  active: 'published',
  retired: 'archived',
}

export function toQStatus(status: FormStatus): QStatus {
  return FORM_TO_Q_STATUS[status]
}

export function fromQStatus(status: QStatus): FormStatus {
  return Q_TO_FORM_STATUS[status] ?? 'draft'
}
