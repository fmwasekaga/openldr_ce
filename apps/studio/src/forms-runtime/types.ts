// Re-export new-model types from the browser-safe forms package entry.
export type { FormSchema, FormField, FormSection, VisibilityRule, VisibilityCondition, FormFieldOption } from '@openldr/forms/pure';

/** Answers keyed by field id. */
export type RuntimeAnswers = Record<string, unknown>;
