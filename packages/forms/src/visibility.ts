import type { FormSchema } from './schema/form-schema';
import type { Answers } from './answer-value';

/** fieldId -> visible? A field with a VisibilityRule shows only when its controller's answer matches. */
export function computeVisibility(form: FormSchema, answers: Answers): Map<string, boolean> {
  const map = new Map<string, boolean>();
  for (const section of form.sections) {
    const sectionVisible = section.visibility ? ruleMatches(section.visibility, answers) : true;
    map.set(section.id, sectionVisible);
    for (const field of section.fields) {
      if (!sectionVisible) {
        map.set(field.id, false);
        continue;
      }
      map.set(field.id, field.visibility ? ruleMatches(field.visibility, answers) : true);
    }
  }
  return map;
}

function ruleMatches(rule: { whenField: string; equals: string | number | boolean }, answers: Answers): boolean {
  const ctrl = answers[rule.whenField];
  const value = typeof ctrl === 'object' && ctrl !== null && 'code' in ctrl ? (ctrl as { code: string }).code : ctrl;
  return value === rule.equals;
}
