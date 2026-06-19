import type { BindingStrength, FieldType, FormField, FormFieldOption, FormSchema, FormSection, VisibilityRule } from './schema/form-schema'
import type { Extension, Questionnaire, QuestionnaireItem } from 'fhir/r4'
import { fromQStatus, reverseFieldType } from './scalar-types'
import { hasKeys, parseTranslations } from './translations'
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
import { deriveLanguagesFromTranslations } from './derive-languages'

const VALID_BINDING_STRENGTHS = new Set<BindingStrength>(['required', 'extensible', 'preferred', 'example'])

function extString(extensions: Extension[] | undefined, url: string): string | null {
  return extensions?.find((e) => e.url === url)?.valueString ?? null
}

function extInt(extensions: Extension[] | undefined, url: string): number | undefined {
  return extensions?.find((e) => e.url === url)?.valueInteger ?? undefined
}

function extBool(extensions: Extension[] | undefined, url: string): boolean {
  return extensions?.find((e) => e.url === url)?.valueBoolean ?? false
}

function isSectionItem(item: QuestionnaireItem): boolean {
  return item.type === 'group' && extBool(item.extension, EXT_CORLIX_SECTION)
}

/** Recover the exact VisibilityRule from its Corlix extension, if present. */
function visibilityOf(extensions: Extension[] | undefined): VisibilityRule | undefined {
  const json = extString(extensions, EXT_CORLIX_VISIBILITY)
  return json ? (JSON.parse(json) as VisibilityRule) : undefined
}

/**
 * Hydrate a FormSchema from a canonical FHIR R4 Questionnaire — inverse of
 * `toQuestionnaire`. Flattens the item tree back to the flat field list,
 * re-deriving each field's `section` / `groupId` from its position. Envelope
 * fields (version, active, facilityId, timestamps) have no Questionnaire source
 * and are returned as neutral placeholders for the persistence layer to overlay.
 */
export function fromQuestionnaire(questionnaire: Questionnaire): FormSchema {
  const fields: FormField[] = []
  const sections: FormSection[] = []
  let fallbackOrder = 0

  const flattenField = (item: QuestionnaireItem, ctx: { section?: string; groupId?: string }): void => {
    const order = extInt(item.extension, EXT_CORLIX_ORDER) ?? fallbackOrder
    fallbackOrder += 1

    const base: FormField = {
      id: item.linkId,
      fhirPath: extString(item.extension, EXT_CORLIX_FHIR_PATH),
      displayLabel: item.text ?? '',
      description: extString(item.extension, EXT_CORLIX_DESCRIPTION),
      fieldType: 'text',
      required: item.required ?? false,
      enabled: true,
      order,
      cardinality: { min: 0, max: '1' },
    }
    const cardinalityJson = extString(item.extension, EXT_CORLIX_CARDINALITY)
    if (cardinalityJson) base.cardinality = JSON.parse(cardinalityJson) as FormField['cardinality']
    const min = extInt(item.extension, EXT_QUESTIONNAIRE_MIN_OCCURS)
    if (min !== undefined) base.minItems = min
    const max = extInt(item.extension, EXT_QUESTIONNAIRE_MAX_OCCURS)
    if (max !== undefined) base.maxItems = max
    if (extBool(item.extension, EXT_SDC_OBSERVATION_EXTRACT)) base.observationExtract = true
    if (ctx.section) base.section = ctx.section
    if (ctx.groupId) base.groupId = ctx.groupId
    const visibility = visibilityOf(item.extension)
    if (visibility) base.visibility = visibility

    const labelTr = parseTranslations(item._text)
    const descExt = item.extension?.find((e) => e.url === EXT_CORLIX_DESCRIPTION)
    const descTr = parseTranslations(descExt?._valueString)
    const translations: Record<string, { label?: string; description?: string }> = {}
    for (const locale of new Set([...Object.keys(labelTr), ...Object.keys(descTr)])) {
      const entry: { label?: string; description?: string } = {}
      if (labelTr[locale] !== undefined) entry.label = labelTr[locale]
      if (descTr[locale] !== undefined) entry.description = descTr[locale]
      translations[locale] = entry
    }
    if (hasKeys(translations)) base.translations = translations

    // Corlix-only authoring/binding props (apiProperty, fhirDiscriminator, enabled, …).
    const extrasJson = extString(item.extension, EXT_CORLIX_FIELD_EXTRAS)
    if (extrasJson) Object.assign(base, JSON.parse(extrasJson) as Partial<FormField>)

    if (item.type === 'group') {
      base.fieldType = 'group'
      fields.push(base)
      for (const child of item.item ?? []) flattenField(child, { groupId: item.linkId })
      return
    }

    const hint = extString(item.extension, EXT_CORLIX_FIELD_TYPE)
    const fieldType = (hint as FieldType | null) ?? reverseFieldType(item.type)
    base.fieldType = fieldType
    if (item.type === 'open-choice') base.allowCustomValue = true
    if (item.repeats && fieldType !== 'multiselect') base.repeatable = true
    if (item.code?.length) {
      base.code = item.code.map((c) => ({ system: c.system ?? '', code: c.code ?? '', ...(c.display ? { display: c.display } : {}) }))
    }
    if (item.answerOption?.length) {
      base.valueSetOptions = item.answerOption.map((o) => {
        const opt: FormFieldOption = { code: o.valueCoding?.code ?? '', display: o.valueCoding?.display ?? '' }
        const tr = parseTranslations(o.valueCoding?._display)
        if (hasKeys(tr)) opt.translations = tr
        return opt
      })
    }
    if (item.answerValueSet) base.valueSetUrl = item.answerValueSet
    const strength = extString(item.extension, EXT_CORLIX_BINDING_STRENGTH)
    if (strength && VALID_BINDING_STRENGTHS.has(strength as BindingStrength)) {
      base.bindingStrength = strength as BindingStrength
    }
    const unit = item.extension?.find((e) => e.url === EXT_QUESTIONNAIRE_UNIT)?.valueCoding?.code
    if (unit) base.unit = unit
    fields.push(base)
  }

  for (const item of questionnaire.item ?? []) {
    if (isSectionItem(item)) {
      const section: FormSection = {
        id: item.linkId,
        label: item.text ?? '',
        order: extInt(item.extension, EXT_CORLIX_ORDER) ?? sections.length,
      }
      const resourceType = extString(item.extension, EXT_CORLIX_SECTION_RESOURCE_TYPE)
      if (resourceType) section.fhirResourceType = resourceType
      const sectionVisibility = visibilityOf(item.extension)
      if (sectionVisibility) section.visibility = sectionVisibility
      sections.push(section)
      for (const child of item.item ?? []) flattenField(child, { section: item.linkId })
    } else {
      flattenField(item, {})
    }
  }

  fields.sort((a, b) => a.order - b.order)
  sections.sort((a, b) => a.order - b.order)

  const declaredLangsJson = extString(questionnaire.extension, EXT_CORLIX_LANGUAGES)
  const declaredLangs = declaredLangsJson ? (JSON.parse(declaredLangsJson) as string[]) : undefined
  const derivedLangs = deriveLanguagesFromTranslations(fields)
  const languages = declaredLangs ?? (derivedLangs.length ? derivedLangs : undefined)

  return {
    id: questionnaire.id ?? '',
    name: questionnaire.title ?? '',
    versionLabel: questionnaire.version ?? null,
    fhirVersion: extString(questionnaire.extension, EXT_CORLIX_FHIR_VERSION),
    fhirResourceType: extString(questionnaire.extension, EXT_CORLIX_FHIR_RESOURCE_TYPE),
    fhirProfileUrl: extString(questionnaire.extension, EXT_CORLIX_FHIR_PROFILE_URL),
    facilityId: null,
    fields,
    sections,
    targetPages: [],
    languages,
    version: 1,
    active: true,
    status: fromQStatus(questionnaire.status),
    createdAt: '',
    updatedAt: '',
  }
}
