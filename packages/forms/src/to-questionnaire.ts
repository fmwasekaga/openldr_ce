import type { FormField, FormSchema, FormSection, VisibilityRule } from './schema/form-schema'
import type { Coding, Extension, Questionnaire, QuestionnaireItem } from 'fhir/r4'
import { fieldTypeNeedsHint, nativeItemType, toQStatus } from './scalar-types'
import { toEnableWhen } from './visibility'
import { hasKeys, translationElement } from './translations'
import {
  EXT_CORLIX_BINDING_STRENGTH,
  EXT_CORLIX_DESCRIPTION,
  EXT_CORLIX_FIELD_EXTRAS,
  EXT_CORLIX_FHIR_PATH,
  EXT_CORLIX_FHIR_PROFILE_URL,
  EXT_CORLIX_FHIR_RESOURCE_TYPE,
  EXT_CORLIX_FHIR_VERSION,
  EXT_CORLIX_FIELD_TYPE,
  EXT_CORLIX_CARDINALITY,
  EXT_CORLIX_LANGUAGES,
  EXT_CORLIX_ORDER,
  EXT_CORLIX_SECTION,
  EXT_CORLIX_SECTION_RESOURCE_TYPE,
  EXT_CORLIX_VISIBILITY,
  EXT_QUESTIONNAIRE_MAX_OCCURS,
  EXT_QUESTIONNAIRE_MIN_OCCURS,
  EXT_QUESTIONNAIRE_UNIT,
  EXT_SDC_OBSERVATION_EXTRACT,
} from './extensions'

const stringExt = (url: string, value: string): Extension => ({ url, valueString: value })
const intExt = (url: string, value: number): Extension => ({ url, valueInteger: value })
const boolExt = (url: string, value: boolean): Extension => ({ url, valueBoolean: value })

/** FormField props carried by native Questionnaire fields/extensions — never duplicated into the extras blob. */
const NATIVELY_MAPPED_FIELD_KEYS = new Set<string>([
  'id', 'fhirPath', 'displayLabel', 'description', 'fieldType', 'required', 'order', 'cardinality',
  'valueSetUrl', 'bindingStrength', 'valueSetOptions', 'code', 'section', 'unit', 'allowCustomValue', 'repeatable',
  'minItems', 'maxItems', 'groupId', 'visibility', 'observationExtract', 'translations',
])

/** Corlix-only field props (apiProperty, fhirDiscriminator, enabled, reference config, …) with no native home. */
function fieldExtras(field: FormField): Record<string, unknown> {
  const extras: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(field)) {
    if (NATIVELY_MAPPED_FIELD_KEYS.has(key) || value === undefined) continue
    extras[key] = value
  }
  return extras
}

/**
 * Apply a VisibilityRule to an item: emit native enableWhen/enableBehavior for
 * portability and push the exact rule as a Corlix extension for lossless
 * round-trip. Mutates `extensions`.
 */
function applyVisibility(item: QuestionnaireItem, rule: VisibilityRule, extensions: Extension[]): void {
  const enableWhen = toEnableWhen(rule)
  if (enableWhen.length) {
    item.enableWhen = enableWhen
    item.enableBehavior = rule.combinator
  }
  extensions.push(stringExt(EXT_CORLIX_VISIBILITY, JSON.stringify(rule)))
}

/**
 * Emit standard `translation` extensions for a field's content: label on
 * `item._text`, description on the Corlix description extension's `_valueString`.
 * Mutates `item` and the `extensions` array.
 */
function applyFieldTranslations(item: QuestionnaireItem, field: FormField, extensions: Extension[]): void {
  if (!field.translations) return
  const labelMap: Record<string, string> = {}
  const descMap: Record<string, string> = {}
  for (const [locale, t] of Object.entries(field.translations)) {
    if (t.label !== undefined) labelMap[locale] = t.label
    if (t.description !== undefined) descMap[locale] = t.description
  }
  const textElement = translationElement(labelMap)
  if (textElement) item._text = textElement
  if (hasKeys(descMap)) {
    const descExt = extensions.find((e) => e.url === EXT_CORLIX_DESCRIPTION)
    if (descExt) descExt._valueString = translationElement(descMap)
  }
}

/** Extensions common to every field item: explicit order, binding, help text, repetition bounds. */
function commonFieldExtensions(field: FormField): Extension[] {
  const ext: Extension[] = [intExt(EXT_CORLIX_ORDER, field.order)]
  if (field.fhirPath) ext.push(stringExt(EXT_CORLIX_FHIR_PATH, field.fhirPath))
  if (field.description) ext.push(stringExt(EXT_CORLIX_DESCRIPTION, field.description))
  if (field.cardinality.min !== 0 || field.cardinality.max !== '1') {
    ext.push(stringExt(EXT_CORLIX_CARDINALITY, JSON.stringify(field.cardinality)))
  }
  if (field.minItems !== undefined) ext.push(intExt(EXT_QUESTIONNAIRE_MIN_OCCURS, field.minItems))
  if (field.maxItems !== undefined) ext.push(intExt(EXT_QUESTIONNAIRE_MAX_OCCURS, field.maxItems))
  if (field.observationExtract) ext.push(boolExt(EXT_SDC_OBSERVATION_EXTRACT, true))
  const extras = fieldExtras(field)
  if (Object.keys(extras).length) ext.push(stringExt(EXT_CORLIX_FIELD_EXTRAS, JSON.stringify(extras)))
  return ext
}

/** Serialize a FormField (scalar or group) to a Questionnaire item, recursing into group children. */
function buildItem(field: FormField, childrenByGroup: Map<string, FormField[]>): QuestionnaireItem {
  if (field.fieldType === 'group') {
    const children = (childrenByGroup.get(field.id) ?? []).slice().sort((a, b) => a.order - b.order)
    const item: QuestionnaireItem = {
      linkId: field.id,
      text: field.displayLabel,
      type: 'group',
      repeats: true, // groups always repeat in the merged model
      item: children.map((child) => buildItem(child, childrenByGroup)),
    }
    if (field.required) item.required = true
    const groupExt = commonFieldExtensions(field)
    if (field.visibility) applyVisibility(item, field.visibility, groupExt)
    applyFieldTranslations(item, field, groupExt)
    item.extension = groupExt
    return item
  }

  const isChoice = field.fieldType === 'select' || field.fieldType === 'multiselect'
  const item: QuestionnaireItem = {
    linkId: field.id,
    text: field.displayLabel,
    type: isChoice && field.allowCustomValue ? 'open-choice' : nativeItemType(field.fieldType),
  }
  if (field.required) item.required = true
  if (field.repeatable || field.fieldType === 'multiselect') item.repeats = true
  if (field.code?.length) {
    item.code = field.code.map((c) => ({ system: c.system, code: c.code, ...(c.display ? { display: c.display } : {}) }))
  }
  if (field.valueSetOptions?.length) {
    item.answerOption = field.valueSetOptions.map((o) => {
      const valueCoding: Coding = { code: o.code, display: o.display }
      if (o.translations) {
        const displayElement = translationElement(o.translations)
        if (displayElement) valueCoding._display = displayElement
      }
      return { valueCoding }
    })
  }
  if (field.valueSetUrl) item.answerValueSet = field.valueSetUrl

  const ext = commonFieldExtensions(field)
  if (field.bindingStrength) ext.push(stringExt(EXT_CORLIX_BINDING_STRENGTH, field.bindingStrength))
  if (fieldTypeNeedsHint(field.fieldType)) ext.push(stringExt(EXT_CORLIX_FIELD_TYPE, field.fieldType))
  if (field.unit) ext.push({ url: EXT_QUESTIONNAIRE_UNIT, valueCoding: { code: field.unit } })
  if (field.visibility) applyVisibility(item, field.visibility, ext)
  applyFieldTranslations(item, field, ext)
  item.extension = ext
  return item
}

/** Serialize a FormSection to a `group` item flagged as a section. */
function sectionToItem(section: FormSection, children: QuestionnaireItem[]): QuestionnaireItem {
  const extension: Extension[] = [boolExt(EXT_CORLIX_SECTION, true), intExt(EXT_CORLIX_ORDER, section.order)]
  if (section.fhirResourceType) {
    extension.push(stringExt(EXT_CORLIX_SECTION_RESOURCE_TYPE, section.fhirResourceType))
  }
  const item: QuestionnaireItem = { linkId: section.id, text: section.label, type: 'group', item: children, extension }
  if (section.visibility) applyVisibility(item, section.visibility, extension)
  return item
}

/**
 * Serialize a FormModel (FormSchema) to a canonical FHIR R4 Questionnaire.
 *
 * Builds the item tree from the flat field list: FormSections become marked
 * `group` items holding their top-level fields; `group` fields nest their
 * `groupId` children and always repeat; repeatable scalars set `repeats`.
 * Corlix-specific metadata with no native home rides in `urn:corlix:*`
 * extensions so the definition round-trips losslessly. Persistence/lifecycle
 * envelope fields (version, active, facilityId, timestamps) are not carried.
 */
export function toQuestionnaire(model: FormSchema): Questionnaire {
  const questionnaire: Questionnaire = {
    resourceType: 'Questionnaire',
    id: model.id,
    title: model.name,
    status: toQStatus(model.status),
  }
  if (model.versionLabel) questionnaire.version = model.versionLabel

  const rootExt: Extension[] = []
  if (model.fhirVersion) rootExt.push(stringExt(EXT_CORLIX_FHIR_VERSION, model.fhirVersion))
  if (model.fhirResourceType) rootExt.push(stringExt(EXT_CORLIX_FHIR_RESOURCE_TYPE, model.fhirResourceType))
  if (model.fhirProfileUrl) rootExt.push(stringExt(EXT_CORLIX_FHIR_PROFILE_URL, model.fhirProfileUrl))
  if (model.languages?.length) rootExt.push(stringExt(EXT_CORLIX_LANGUAGES, JSON.stringify(model.languages)))
  if (rootExt.length) questionnaire.extension = rootExt

  const childrenByGroup = new Map<string, FormField[]>()
  for (const field of model.fields) {
    if (!field.groupId) continue
    const arr = childrenByGroup.get(field.groupId) ?? []
    arr.push(field)
    childrenByGroup.set(field.groupId, arr)
  }

  const topLevel = model.fields.filter((f) => !f.groupId)
  const sectionIds = new Set(model.sections.map((s) => s.id))
  const items: QuestionnaireItem[] = []

  for (const section of [...model.sections].sort((a, b) => a.order - b.order)) {
    const sectionFields = topLevel.filter((f) => f.section === section.id).sort((a, b) => a.order - b.order)
    items.push(sectionToItem(section, sectionFields.map((f) => buildItem(f, childrenByGroup))))
  }

  const unsectioned = topLevel
    .filter((f) => !f.section || !sectionIds.has(f.section))
    .sort((a, b) => a.order - b.order)
  for (const field of unsectioned) items.push(buildItem(field, childrenByGroup))

  if (items.length) questionnaire.item = items
  return questionnaire
}
