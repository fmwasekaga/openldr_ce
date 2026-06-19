import type { FormField, FormSchema } from './schema/form-schema'
import type { QuestionnaireResponse, QuestionnaireResponseItem, QuestionnaireResponseItemAnswer } from 'fhir/r4'
import { toAnswer, type AnswerState } from './answer-value'

/** Coerce a stored value into instance-array form (mirrors renderer formRepeat.asInstances). */
function asInstances(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw
  if (raw === undefined || raw === null || raw === '') return []
  return [raw]
}

function isInstanceObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

const byOrder = (a: FormField, b: FormField) => a.order - b.order
const nonNull = (a: QuestionnaireResponseItemAnswer | null): a is QuestionnaireResponseItemAnswer => a !== null

/** QR items for one scalar/repeatable field, given its value source (form values or a group instance). */
function scalarItems(field: FormField, source: Record<string, unknown>): QuestionnaireResponseItem[] {
  if (field.repeatable || field.fieldType === 'multiselect') {
    const answer = asInstances(source[field.id]).map((v) => toAnswer(field, v)).filter(nonNull)
    return answer.length ? [{ linkId: field.id, answer }] : []
  }
  const a = toAnswer(field, source[field.id])
  return a ? [{ linkId: field.id, answer: [a] }] : []
}

/** QR items for one field (scalar, repeatable, or a repeating group → one item per instance). */
function itemsForField(
  field: FormField,
  source: Record<string, unknown>,
  childrenByGroup: Map<string, FormField[]>,
): QuestionnaireResponseItem[] {
  if (field.fieldType !== 'group') return scalarItems(field, source)

  const children = (childrenByGroup.get(field.id) ?? []).slice().sort(byOrder)
  const instances = asInstances(source[field.id]).filter(isInstanceObject)
  return instances.map((instance) => ({
    linkId: field.id,
    item: children.flatMap((child) => itemsForField(child, instance, childrenByGroup)),
  }))
}

/**
 * Build a QuestionnaireResponse from a FormModel + filled AnswerState. The item
 * tree mirrors the Questionnaire (sections wrap their fields; repeating groups
 * emit one item per instance; repeatable/multiselect fields emit multiple
 * answers). Items with no answer are omitted. Pure.
 */
export function toQuestionnaireResponse(model: FormSchema, answers: AnswerState): QuestionnaireResponse {
  const childrenByGroup = new Map<string, FormField[]>()
  for (const field of model.fields) {
    if (!field.groupId) continue
    const arr = childrenByGroup.get(field.groupId) ?? []
    arr.push(field)
    childrenByGroup.set(field.groupId, arr)
  }

  const topLevel = model.fields.filter((f) => !f.groupId)
  const sectionIds = new Set(model.sections.map((s) => s.id))
  const items: QuestionnaireResponseItem[] = []

  for (const section of [...model.sections].sort((a, b) => a.order - b.order)) {
    const fields = topLevel.filter((f) => f.section === section.id).sort(byOrder)
    const children = fields.flatMap((f) => itemsForField(f, answers, childrenByGroup))
    if (children.length) items.push({ linkId: section.id, item: children })
  }

  const unsectioned = topLevel.filter((f) => !f.section || !sectionIds.has(f.section)).sort(byOrder)
  for (const field of unsectioned) items.push(...itemsForField(field, answers, childrenByGroup))

  const response: QuestionnaireResponse = { resourceType: 'QuestionnaireResponse', status: 'completed' }
  if (items.length) response.item = items
  return response
}
