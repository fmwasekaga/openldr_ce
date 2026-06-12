import type { QuestionnaireResponse } from '@openldr/fhir';
import type { FormSchema } from './schema/form-schema';
import { toAnswer, readAnswer, type AnswerValue, type Answers } from './answer-value';

export type { Answers };

export interface ResponseMeta {
  status?: 'in-progress' | 'completed' | 'amended' | 'entered-in-error' | 'stopped';
  subject?: { reference: string };
  authored?: string;
  questionnaire?: string;
}

export function buildResponse(form: FormSchema, answers: Answers, meta: ResponseMeta = {}): QuestionnaireResponse {
  const item = form.sections.map((section) => ({
    linkId: section.id,
    text: section.title.en,
    item: section.fields
      .filter((f) => answers[f.id] !== undefined)
      .map((f) => {
        const raw = answers[f.id];
        const values = Array.isArray(raw) ? raw : [raw];
        return { linkId: f.id, text: f.label.en, answer: values.map((v) => toAnswer(f.type, v)) };
      }),
  }));
  return {
    resourceType: 'QuestionnaireResponse',
    status: meta.status ?? 'completed',
    ...(meta.questionnaire ? { questionnaire: meta.questionnaire } : {}),
    ...(meta.subject ? { subject: meta.subject } : {}),
    ...(meta.authored ? { authored: meta.authored } : {}),
    item,
  } as QuestionnaireResponse;
}

export function parseResponse(qr: QuestionnaireResponse): Answers {
  const out: Answers = {};
  const walk = (items: unknown): void => {
    if (!Array.isArray(items)) return;
    for (const it of items as Array<Record<string, unknown>>) {
      const answers = it.answer as Array<Record<string, unknown>> | undefined;
      if (answers && answers.length > 0) {
        const values = answers.map(readAnswer).filter((v): v is AnswerValue => v !== undefined);
        out[it.linkId as string] = values.length === 1 ? (values[0] as AnswerValue) : values;
      }
      if (it.item) walk(it.item);
    }
  };
  walk(qr.item);
  return out;
}
