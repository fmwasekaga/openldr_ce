import type { FormSchema } from './schema/form-schema';
import type { AnswerState } from './answer-value';

export interface AnswerError {
  fieldId: string;
  label: string;
  reason: string;
}

function isEmpty(v: unknown): boolean {
  return (
    v === undefined ||
    v === null ||
    (typeof v === 'string' && v.trim() === '') ||
    (Array.isArray(v) && v.length === 0)
  );
}

/**
 * Validate filled answers against a form's field contract. Pure; never throws.
 * Checks required presence, select/multiselect option membership (unless
 * allowCustomValue), numeric min/max, and text maxLength. Disabled and group
 * container fields are skipped. Returns a flat list of errors ([] = valid).
 */
export function validateAnswers(model: FormSchema, answers: AnswerState): AnswerError[] {
  const errors: AnswerError[] = [];
  for (const f of model.fields) {
    if (f.enabled === false) continue;
    if (f.fieldType === 'group') continue;

    const value = answers[f.id];
    const push = (reason: string) => errors.push({ fieldId: f.id, label: f.displayLabel, reason });

    if (isEmpty(value)) {
      if (f.required) push('required');
      continue;
    }

    if (f.fieldType === 'select' || f.fieldType === 'multiselect') {
      const options = f.valueSetOptions ?? [];
      if (!f.allowCustomValue && options.length > 0) {
        const values = Array.isArray(value) ? value : [value];
        for (const v of values) {
          if (!options.some((o) => o.code === String(v))) push(`'${String(v)}' is not an allowed option`);
        }
      }
    } else if (f.fieldType === 'number') {
      const n = Number(value);
      if (Number.isNaN(n)) {
        push(`'${String(value)}' is not a number`);
      } else {
        if (f.constraints?.min !== undefined && n < f.constraints.min) push(`must be >= ${f.constraints.min}`);
        if (f.constraints?.max !== undefined && n > f.constraints.max) push(`must be <= ${f.constraints.max}`);
      }
    } else if (f.constraints?.maxLength !== undefined && String(value).length > f.constraints.maxLength) {
      push(`exceeds max length ${f.constraints.maxLength}`);
    }
  }
  return errors;
}
