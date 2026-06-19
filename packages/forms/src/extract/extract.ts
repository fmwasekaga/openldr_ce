import type {
  Coding,
  FhirResource,
  Observation,
  Quantity,
  Questionnaire,
  QuestionnaireItem,
  QuestionnaireResponse,
  QuestionnaireResponseItem,
  QuestionnaireResponseItemAnswer,
  Reference,
  ServiceRequest,
} from 'fhir/r4'
import { fromAnswer } from '../answer-value'
import { EXT_CORLIX_FHIR_PATH, EXT_QUESTIONNAIRE_UNIT, EXT_SDC_OBSERVATION_EXTRACT } from '../extensions'

/** Context the extractors need but the form can't supply (e.g. the encounter's subject). */
export interface ExtractionContext {
  subject?: Reference
  authored?: string
}

/** Pluggable extraction of discrete FHIR resources from a filled form (PRD §3.2). */
export interface ResourceExtractor {
  extract(
    response: QuestionnaireResponse,
    questionnaire: Questionnaire,
    ctx: ExtractionContext,
  ): FhirResource[]
}

// ─── Questionnaire indexing ──────────────────────────────────────────────────

interface ItemMeta {
  observationExtract: boolean
  code?: Coding[]
  unit?: string
  fhirPath?: string
  answerOptions?: Array<{ code?: string; display?: string }>
}

function indexItems(questionnaire: Questionnaire): Map<string, ItemMeta> {
  const map = new Map<string, ItemMeta>()
  const walk = (items: QuestionnaireItem[] | undefined): void => {
    for (const item of items ?? []) {
      map.set(item.linkId, {
        observationExtract:
          item.extension?.some((e) => e.url === EXT_SDC_OBSERVATION_EXTRACT && e.valueBoolean === true) === true,
        code: item.code,
        unit: item.extension?.find((e) => e.url === EXT_QUESTIONNAIRE_UNIT)?.valueCoding?.code,
        fhirPath: item.extension?.find((e) => e.url === EXT_CORLIX_FHIR_PATH)?.valueString,
        answerOptions: item.answerOption?.map((o) => ({ code: o.valueCoding?.code, display: o.valueCoding?.display })),
      })
      walk(item.item)
    }
  }
  walk(questionnaire.item)
  return map
}

const LOINC = 'http://loinc.org'

function walkResponse(items: QuestionnaireResponseItem[] | undefined, visit: (item: QuestionnaireResponseItem) => void): void {
  for (const item of items ?? []) {
    visit(item)
    walkResponse(item.item, visit)
  }
}

// ─── Observation extraction ──────────────────────────────────────────────────

const UCUM = 'http://unitsofmeasure.org'

function observationValue(answer: QuestionnaireResponseItemAnswer, unit?: string): Partial<Observation> {
  const num = answer.valueDecimal ?? answer.valueInteger
  if (num !== undefined) {
    const quantity: Quantity = { value: num }
    if (unit) {
      quantity.unit = unit
      quantity.code = unit
      quantity.system = UCUM
    }
    return { valueQuantity: quantity }
  }
  if (answer.valueBoolean !== undefined) return { valueBoolean: answer.valueBoolean }
  if (answer.valueDate !== undefined) return { valueDateTime: answer.valueDate }
  if (answer.valueDateTime !== undefined) return { valueDateTime: answer.valueDateTime }
  if (answer.valueCoding !== undefined) return { valueCodeableConcept: { coding: [answer.valueCoding] } }
  if (answer.valueString !== undefined) return { valueString: answer.valueString }
  return {}
}

/**
 * Emit one Observation per answer for items flagged `observationExtract` that
 * carry a LOINC (or other) `item.code` (PRD §3.5). Repeating-group instances
 * each yield their own Observation.
 */
export const ObservationExtractor: ResourceExtractor = {
  extract(response, questionnaire, ctx) {
    const index = indexItems(questionnaire)
    const out: Observation[] = []
    walkResponse(response.item, (item) => {
      const meta = index.get(item.linkId)
      if (!meta?.observationExtract || !meta.code?.length) return
      for (const answer of item.answer ?? []) {
        const observation: Observation = { resourceType: 'Observation', status: 'final', code: { coding: meta.code } }
        if (ctx.subject) observation.subject = ctx.subject
        if (ctx.authored) observation.effectiveDateTime = ctx.authored
        Object.assign(observation, observationValue(answer, meta.unit))
        out.push(observation)
      }
    })
    return out
  },
}

// ─── ServiceRequest extraction (requisition domain) ──────────────────────────

/**
 * Emit a single ServiceRequest for a requisition form, mapping answers whose
 * field is bound to `ServiceRequest.*` (via the Corlix fhir-path) onto it.
 */
export const ServiceRequestExtractor: ResourceExtractor = {
  extract(response, questionnaire, ctx) {
    const index = indexItems(questionnaire)
    const request: ServiceRequest = {
      resourceType: 'ServiceRequest',
      status: 'active',
      intent: 'order',
      subject: ctx.subject ?? { display: 'Unknown subject' }, // subject is required by FHIR
    }
    if (ctx.authored) request.authoredOn = ctx.authored

    const codings: Coding[] = []
    walkResponse(response.item, (item) => {
      const meta = index.get(item.linkId)
      const path = meta?.fhirPath
      if (path === undefined) return

      // The ordered test(s) → ServiceRequest.code (LOINC). A field bound to
      // ServiceRequest.code carries the LOINC code as its answer; display comes
      // from the Questionnaire answerOption.
      if (path === 'ServiceRequest.code') {
        for (const answer of item.answer ?? []) {
          const code = answer.valueCoding?.code ?? answer.valueString
          if (!code) continue
          const display = meta?.answerOptions?.find((o) => o.code === code)?.display
          codings.push({ system: LOINC, code, ...(display ? { display } : {}) })
        }
        return
      }

      const value = item.answer?.[0] ? fromAnswer(item.answer[0]) : undefined
      if (value === undefined) return
      if (path === 'ServiceRequest.identifier') request.identifier = [{ value: String(value) }]
      if (path === 'ServiceRequest.priority') request.priority = String(value) as ServiceRequest['priority']
    })
    if (codings.length) request.code = { coding: codings }

    return [request]
  },
}
