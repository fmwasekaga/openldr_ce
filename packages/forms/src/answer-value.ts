import type { FieldType } from './schema/form-schema';

export type AnswerValue =
  | string
  | number
  | boolean
  | { code: string; display?: string; system?: string }
  | { value?: number; unit?: string };

export type Answers = Record<string, AnswerValue | AnswerValue[]>;

export function toAnswer(type: FieldType, value: AnswerValue): Record<string, unknown> {
  switch (type) {
    case 'string':
    case 'text':
      return { valueString: value };
    case 'integer':
      return { valueInteger: value };
    case 'decimal':
      return { valueDecimal: value };
    case 'boolean':
      return { valueBoolean: value };
    case 'date':
      return { valueDate: value };
    case 'dateTime':
      return { valueDateTime: value };
    case 'choice':
    case 'open-choice': {
      const c = value as { code: string; display?: string; system?: string };
      return { valueCoding: { system: c.system, code: c.code, display: c.display } };
    }
    case 'reference':
      return { valueReference: { reference: value } };
    case 'quantity': {
      const q = value as { value?: number; unit?: string };
      return { valueQuantity: { value: q.value, unit: q.unit } };
    }
    default:
      return { valueString: String(value) };
  }
}

export function readAnswer(answer: Record<string, unknown>): AnswerValue | undefined {
  if ('valueString' in answer) return answer.valueString as string;
  if ('valueInteger' in answer) return answer.valueInteger as number;
  if ('valueDecimal' in answer) return answer.valueDecimal as number;
  if ('valueBoolean' in answer) return answer.valueBoolean as boolean;
  if ('valueDate' in answer) return answer.valueDate as string;
  if ('valueDateTime' in answer) return answer.valueDateTime as string;
  if ('valueCoding' in answer) {
    const c = answer.valueCoding as { code: string; display?: string; system?: string };
    return { code: c.code, display: c.display, system: c.system };
  }
  if ('valueReference' in answer) return (answer.valueReference as { reference: string }).reference;
  if ('valueQuantity' in answer) {
    const q = answer.valueQuantity as { value?: number; unit?: string };
    return { value: q.value, unit: q.unit };
  }
  return undefined;
}
