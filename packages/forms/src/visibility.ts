import type { FormSchema } from './schema/form-schema';
import type { Answers } from './answer-value';

/** fieldId -> visible? A field with a VisibilityRule shows only when its controller's answer matches. */
export function computeVisibility(form: FormSchema, answers: Answers): Map<string, boolean> {
  const map = new Map<string, boolean>();
  for (const section of form.sections) {
    for (const field of section.fields) {
      if (!field.visibility) {
        map.set(field.id, true);
        continue;
      }
      const ctrl = answers[field.visibility.whenField];
      const value = typeof ctrl === 'object' && ctrl !== null && 'code' in ctrl ? (ctrl as { code: string }).code : ctrl;
      map.set(field.id, value === field.visibility.equals);
    }
  }
  return map;
}
