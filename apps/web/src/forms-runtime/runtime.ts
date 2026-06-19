import type { RuntimeAnswers, RuntimeAnswerValue, RuntimeField, RuntimeFormSchema } from './types';

function answerComparable(value: unknown): unknown {
  return value && typeof value === 'object' && 'code' in value ? (value as { code: string }).code : value;
}

export function visibleFieldIds(form: RuntimeFormSchema, answers: RuntimeAnswers): Set<string> {
  const visible = new Set<string>();
  for (const section of form.sections) {
    for (const field of section.fields) {
      if (!field.visibility || answerComparable(answers[field.visibility.whenField]) === field.visibility.equals) {
        visible.add(field.id);
      }
    }
  }
  return visible;
}

function isEmpty(value: unknown): boolean {
  return value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0);
}

function typeOk(field: RuntimeField, value: RuntimeAnswerValue): boolean {
  switch (field.type) {
    case 'string':
    case 'text':
    case 'date':
    case 'dateTime':
    case 'reference':
      return typeof value === 'string';
    case 'integer':
    case 'decimal':
      return typeof value === 'number' && Number.isFinite(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'choice':
    case 'open-choice':
      return typeof value === 'object' && value !== null && 'code' in value;
    case 'quantity':
      return typeof value === 'object' && value !== null && 'value' in value;
    default:
      return false;
  }
}

export function validateClient(form: RuntimeFormSchema, answers: RuntimeAnswers): Record<string, string> {
  const visible = visibleFieldIds(form, answers);
  const errors: Record<string, string> = {};
  for (const section of form.sections) {
    for (const field of section.fields) {
      if (!visible.has(field.id)) continue;
      const raw = answers[field.id];
      const values = (raw === undefined ? [] : Array.isArray(raw) ? raw : [raw]).filter((value) => !isEmpty(value));
      if (field.required && values.length === 0) {
        errors[field.id] = `field ${field.id} is required`;
        continue;
      }
      for (const value of values) {
        if (!typeOk(field, value)) {
          errors[field.id] = `field ${field.id} has the wrong type`;
          break;
        }
        if (field.type === 'choice' && field.options) {
          const code = (value as { code: string }).code;
          if (!field.options.some((option) => option.code === code)) errors[field.id] = `field ${field.id} value '${code}' not in options`;
        }
      }
      if (field.cardinality) {
        if (field.cardinality.min !== undefined && values.length < field.cardinality.min) errors[field.id] = `field ${field.id} below min cardinality`;
        if (field.cardinality.max !== undefined && values.length > field.cardinality.max) errors[field.id] = `field ${field.id} above max cardinality`;
      }
    }
  }
  return errors;
}

export function cleanAnswers(form: RuntimeFormSchema, answers: RuntimeAnswers): RuntimeAnswers {
  const visible = visibleFieldIds(form, answers);
  const out: RuntimeAnswers = {};
  for (const section of form.sections) {
    for (const field of section.fields) {
      if (!visible.has(field.id)) continue;
      const raw = answers[field.id];
      const values = (raw === undefined ? [] : Array.isArray(raw) ? raw : [raw]).filter((value) => !isEmpty(value));
      if (values.length === 0) continue;
      out[field.id] = field.repeats ? values : values[0]!;
    }
  }
  return out;
}

export function formatFieldValue(field: RuntimeField, value: unknown): string {
  if (field.type === 'choice' || field.type === 'open-choice') return value && typeof value === 'object' && 'code' in value ? (value as { code: string }).code : '';
  if (field.type === 'quantity') return value && typeof value === 'object' && 'value' in value ? String((value as { value?: number }).value ?? '') : '';
  return value == null ? '' : String(value);
}

export function fieldValue(field: RuntimeField, raw: string | boolean): RuntimeAnswerValue | undefined {
  if (raw === '') return undefined;
  switch (field.type) {
    case 'integer':
      return Number.parseInt(String(raw), 10);
    case 'decimal':
      return Number.parseFloat(String(raw));
    case 'boolean':
      return Boolean(raw);
    case 'choice': {
      const option = field.options?.find((item) => item.code === raw);
      return { code: String(raw), display: option?.display.en, system: option?.system };
    }
    case 'open-choice': {
      const option = field.options?.find((item) => item.code === raw);
      return { code: String(raw), display: option?.display.en ?? String(raw), system: option?.system };
    }
    case 'quantity':
      return { value: Number.parseFloat(String(raw)), unit: field.unit };
    default:
      return String(raw);
  }
}
