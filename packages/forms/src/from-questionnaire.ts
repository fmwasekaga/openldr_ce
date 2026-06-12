import type { Questionnaire } from '@openldr/fhir';
import type { FormSchema, FormField, FormSection } from './schema/form-schema';
import { EXT_OPENLDR_FORM, EXT_OPENLDR_SECTION, EXT_OPENLDR_FIELD, extString } from './extensions';

export function fromQuestionnaire(q: Questionnaire): FormSchema {
  const formMeta = JSON.parse(extString((q as { extension?: unknown }).extension, EXT_OPENLDR_FORM) ?? '{}') as Omit<FormSchema, 'sections'>;
  const groups = (q as { item?: Array<Record<string, unknown>> }).item ?? [];
  const sections: FormSection[] = groups.map((g) => {
    const meta = JSON.parse(extString(g.extension, EXT_OPENLDR_SECTION) ?? '{}') as Omit<FormSection, 'fields'>;
    const leaves = (g.item as Array<Record<string, unknown>> | undefined) ?? [];
    const fields: FormField[] = leaves.map((leaf) => JSON.parse(extString(leaf.extension, EXT_OPENLDR_FIELD) ?? '{}') as FormField);
    return { ...meta, fields };
  });
  return { ...formMeta, sections };
}
