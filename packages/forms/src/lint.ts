export type FormLintSeverity = 'error' | 'warning';

export interface FormLintIssue {
  severity: FormLintSeverity;
  code:
    | 'duplicate-id'
    | 'duplicate-fhir-path'
    | 'choice-missing-options'
    | 'observation-extract-missing-code'
    | 'cardinality-min-greater-than-max'
    | 'visibility-missing-field';
  message: string;
  fieldId?: string;
  sectionId?: string;
}

type DraftObject = Record<string, unknown>;

export function lintFormSchema(form: unknown): FormLintIssue[] {
  const issues: FormLintIssue[] = [];
  const seenIds = new Map<string, { sectionId?: string; fieldId?: string }>();
  const fhirPaths = new Map<string, string>();
  const fieldIds = new Set<string>();
  const visibilityRules: Array<{ sectionId: string; fieldId: string; whenField: string }> = [];

  for (const section of sectionsOf(form)) {
    const sectionId = stringValue(section.id) ?? '';
    recordId(sectionId, { sectionId });

    for (const field of fieldsOf(section)) {
      const fieldId = stringValue(field.id) ?? '';
      recordId(fieldId, { sectionId, fieldId });
      if (fieldId) fieldIds.add(fieldId);

      const fhirPath = stringValue(field.fhirPath);
      if (fhirPath) {
        const firstField = fhirPaths.get(fhirPath);
        if (firstField) {
          issues.push({ severity: 'warning', code: 'duplicate-fhir-path', message: `FHIR path "${fhirPath}" is used by multiple fields`, fieldId, sectionId });
        } else {
          fhirPaths.set(fhirPath, fieldId);
        }
      }

      const type = stringValue(field.type);
      const options = Array.isArray(field.options) ? field.options : undefined;
      const hasValueSetBinding = isObject(field.valueSetBinding) && typeof field.valueSetBinding.url === 'string' && field.valueSetBinding.url.length > 0;
      if ((type === 'choice' || type === 'open-choice') && (!options || options.length === 0) && !hasValueSetBinding) {
        issues.push({ severity: 'error', code: 'choice-missing-options', message: 'Choice fields require options or a value set binding', fieldId, sectionId });
      }

      if (field.observationExtract === true && !isObject(field.code)) {
        issues.push({ severity: 'error', code: 'observation-extract-missing-code', message: 'Observation extraction requires a code', fieldId, sectionId });
      }

      if (isObject(field.cardinality) && typeof field.cardinality.min === 'number' && typeof field.cardinality.max === 'number' && field.cardinality.min > field.cardinality.max) {
        issues.push({ severity: 'error', code: 'cardinality-min-greater-than-max', message: 'Minimum cardinality cannot be greater than maximum cardinality', fieldId, sectionId });
      }

      if (isObject(field.visibility)) {
        const whenField = stringValue(field.visibility.whenField);
        if (whenField) visibilityRules.push({ sectionId, fieldId, whenField });
      }
    }
  }

  for (const rule of visibilityRules) {
    if (!fieldIds.has(rule.whenField)) {
      issues.push({ severity: 'error', code: 'visibility-missing-field', message: `Visibility references missing field "${rule.whenField}"`, fieldId: rule.fieldId, sectionId: rule.sectionId });
    }
  }

  return issues;

  function recordId(id: string, location: { sectionId?: string; fieldId?: string }): void {
    if (!id) return;
    if (seenIds.has(id)) {
      issues.push({ severity: 'error', code: 'duplicate-id', message: `Duplicate id "${id}"`, ...location });
      return;
    }
    seenIds.set(id, location);
  }
}

function sectionsOf(form: unknown): DraftObject[] {
  return isObject(form) && Array.isArray(form.sections) ? form.sections.filter(isObject) : [];
}

function fieldsOf(section: DraftObject): DraftObject[] {
  return Array.isArray(section.fields) ? section.fields.filter(isObject) : [];
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function isObject(value: unknown): value is DraftObject {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
