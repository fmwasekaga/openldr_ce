import type { Questionnaire, QuestionnaireItem, QuestionnaireResponse, QuestionnaireResponseItem } from 'fhir/r4'
import { fromAnswer, type AnswerState } from './answer-value'
import { EXT_CORLIX_SECTION } from './extensions'

type ItemInfo = { type: string; repeats: boolean; isSection: boolean }

/** Index a Questionnaire's items by linkId so the response can be re-shaped (array vs scalar, group vs section). */
function indexQuestionnaire(questionnaire: Questionnaire): Map<string, ItemInfo> {
  const map = new Map<string, ItemInfo>()
  const walk = (items: QuestionnaireItem[] | undefined): void => {
    for (const item of items ?? []) {
      const isSection =
        item.type === 'group' && item.extension?.some((e) => e.url === EXT_CORLIX_SECTION && e.valueBoolean === true) === true
      map.set(item.linkId, { type: item.type, repeats: item.repeats === true, isSection })
      walk(item.item)
    }
  }
  walk(questionnaire.item)
  return map
}

/** Reduce a list of response items into the target answer object, using the Questionnaire index for structure. */
function collect(items: QuestionnaireResponseItem[], info: Map<string, ItemInfo>, target: Record<string, unknown>): void {
  const groupInstances = new Map<string, Record<string, unknown>[]>()

  for (const item of items) {
    const meta = info.get(item.linkId)

    if (meta?.isSection) {
      collect(item.item ?? [], info, target) // section fields live flat in the answer state
      continue
    }

    if (meta?.type === 'group') {
      const instance: Record<string, unknown> = {}
      collect(item.item ?? [], info, instance)
      const arr = groupInstances.get(item.linkId) ?? []
      arr.push(instance)
      groupInstances.set(item.linkId, arr)
      continue
    }

    const values = (item.answer ?? []).map(fromAnswer)
    target[item.linkId] = meta?.repeats ? values : values[0]
  }

  for (const [linkId, instances] of groupInstances) target[linkId] = instances
}

/**
 * Hydrate an AnswerState from a QuestionnaireResponse, using its Questionnaire to
 * recover structure (repeatable → array, repeating group → array of instances,
 * section → flat). Inverse of `toQuestionnaireResponse`. Pure.
 */
export function fromQuestionnaireResponse(response: QuestionnaireResponse, questionnaire: Questionnaire): AnswerState {
  const answers: AnswerState = {}
  collect(response.item ?? [], indexQuestionnaire(questionnaire), answers)
  return answers
}
