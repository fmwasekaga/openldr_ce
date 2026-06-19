import type { FormSchema, RuntimeAnswers } from './types';

/**
 * Build a synthetic set of answers for a form schema — one plausible value per
 * enabled field. Used by the builder's live Preview panel to populate the form
 * without requiring the user to type anything.
 */
export function makeExampleAnswers(schema: FormSchema): RuntimeAnswers {
  const answers: RuntimeAnswers = {};

  for (const field of schema.fields) {
    // Skip disabled fields
    if (field.enabled === false) continue;

    switch (field.fieldType) {
      case 'text':
      case 'phone':
      case 'email':
      case 'identifier':
      case 'address':
        answers[field.id] = 'Example';
        break;

      case 'number':
        answers[field.id] = 1;
        break;

      case 'boolean':
        answers[field.id] = true;
        break;

      case 'date':
        answers[field.id] = '2026-01-01';
        break;

      case 'datetime':
        answers[field.id] = '2026-01-01T00:00';
        break;

      case 'select': {
        const code = field.valueSetOptions?.[0]?.code;
        if (code !== undefined) answers[field.id] = code;
        break;
      }

      case 'multiselect': {
        const code = field.valueSetOptions?.[0]?.code;
        answers[field.id] = code !== undefined ? [code] : [];
        break;
      }

      case 'reference':
      case 'facility':
      case 'organism':
      case 'antibiogram':
        answers[field.id] = 'example';
        break;

      // group and attachment — omit
      case 'group':
      case 'attachment':
      default:
        break;
    }
  }

  return answers;
}
