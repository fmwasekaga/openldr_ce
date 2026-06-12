import { type OperationOutcome, outcomeFromIssues, type OperationOutcomeIssue } from '@openldr/fhir';
import type { FormSchema, FormField } from './schema/form-schema';
import type { Answers, AnswerValue } from './answer-value';
import { computeVisibility } from './visibility';

export type ValidateResult = { ok: true } | { ok: false; outcome: OperationOutcome };

function typeOk(field: FormField, v: AnswerValue): boolean {
  switch (field.type) {
    case 'string': case 'text': case 'date': case 'dateTime': case 'reference':
      return typeof v === 'string';
    case 'integer': case 'decimal':
      return typeof v === 'number';
    case 'boolean':
      return typeof v === 'boolean';
    case 'choice': case 'open-choice':
      return typeof v === 'object' && v !== null && 'code' in v;
    case 'quantity':
      return typeof v === 'object' && v !== null && 'value' in v;
    default:
      return false;
  }
}

export function validateAnswers(form: FormSchema, answers: Answers): ValidateResult {
  const visible = computeVisibility(form, answers);
  const issues: OperationOutcomeIssue[] = [];
  const add = (code: string, msg: string, fieldId: string) =>
    issues.push({ severity: 'error', code, diagnostics: msg, expression: [fieldId] });

  for (const section of form.sections) {
    for (const field of section.fields) {
      if (visible.get(field.id) === false) continue;
      const raw = answers[field.id];
      const values = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];

      if (field.required && values.length === 0) {
        add('required', `field ${field.id} is required`, field.id);
        continue;
      }
      for (const v of values) {
        if (!typeOk(field, v)) {
          add('value', `field ${field.id} has the wrong type`, field.id);
          continue;
        }
        if (field.type === 'choice' && field.options) {
          const code = (v as { code: string }).code;
          if (!field.options.some((o) => o.code === code)) {
            add('value', `field ${field.id} value '${code}' not in options`, field.id);
          }
        }
      }
      if (field.cardinality) {
        if (field.cardinality.min !== undefined && values.length < field.cardinality.min) add('value', `field ${field.id} below min cardinality`, field.id);
        if (field.cardinality.max !== undefined && values.length > field.cardinality.max) add('value', `field ${field.id} above max cardinality`, field.id);
      }
    }
  }
  return issues.length === 0 ? { ok: true } : { ok: false, outcome: outcomeFromIssues(issues) };
}
