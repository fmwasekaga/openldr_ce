import type { Questionnaire } from '@openldr/fhir';
import type { FormSchema, FormSection, FormField } from './schema/form-schema';
import { EXT_OPENLDR_FORM, EXT_OPENLDR_SECTION, EXT_OPENLDR_FIELD } from './extensions';

type VisibilityRule = NonNullable<FormField['visibility']>;

function enableWhenOf(v: VisibilityRule): Record<string, unknown> {
  const base = { question: v.whenField, operator: '=' };
  if (typeof v.equals === 'boolean') return { ...base, answerBoolean: v.equals };
  if (typeof v.equals === 'number') return { ...base, answerDecimal: v.equals };
  return { ...base, answerString: v.equals };
}

function fieldItem(field: FormField): Record<string, unknown> {
  const item: Record<string, unknown> = {
    linkId: field.id,
    type: field.type,
    text: field.label.en,
    required: field.required ?? false,
    repeats: field.repeats ?? false,
    extension: [{ url: EXT_OPENLDR_FIELD, valueString: JSON.stringify(field) }],
  };
  if (field.options) {
    item.answerOption = field.options.map((o) => ({ valueCoding: { system: o.system, code: o.code, display: o.display.en } }));
  }
  if (field.visibility) item.enableWhen = [enableWhenOf(field.visibility)];
  return item;
}

function sectionItem(section: FormSection): Record<string, unknown> {
  const { fields, ...meta } = section;
  const item: Record<string, unknown> = {
    linkId: section.id,
    type: 'group',
    text: section.title.en,
    repeats: section.repeats ?? false,
    extension: [{ url: EXT_OPENLDR_SECTION, valueString: JSON.stringify(meta) }],
    item: fields.map(fieldItem),
  };
  if (section.visibility) item.enableWhen = [enableWhenOf(section.visibility)];
  return item;
}

export function toQuestionnaire(form: FormSchema): Questionnaire {
  const { sections, ...formMeta } = form;
  return {
    resourceType: 'Questionnaire',
    name: form.name,
    title: form.title.en,
    status: form.status,
    extension: [{ url: EXT_OPENLDR_FORM, valueString: JSON.stringify(formMeta) }],
    item: sections.map(sectionItem),
  } as Questionnaire;
}
