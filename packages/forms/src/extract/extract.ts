import { randomUUID } from 'node:crypto';
import { validateResource, type FhirResource, type Questionnaire, type QuestionnaireResponse } from '@openldr/fhir';
import type { FormField } from '../schema/form-schema';
import { fromQuestionnaire } from '../from-questionnaire';
import { parseResponse } from '../response';
import type { Answers, AnswerValue } from '../answer-value';
import { setPath } from './set-path';
import type { ExtractionContext, ExtractionResult } from './context';
import { computeVisibility } from '../visibility';

const SUBJECT_TYPES = new Set(['ServiceRequest', 'Specimen', 'Observation', 'DiagnosticReport']);

function extractValue(field: FormField, v: AnswerValue): unknown {
  switch (field.type) {
    case 'choice':
    case 'open-choice':
      return (v as { code: string }).code;
    case 'reference':
      return { reference: v as string };
    case 'quantity':
      return { value: (v as { value?: number }).value, unit: (v as { unit?: string }).unit };
    default:
      return v;
  }
}

function observationOf(field: FormField, v: AnswerValue, ctx: ExtractionContext): FhirResource {
  const obs: Record<string, unknown> = {
    resourceType: 'Observation',
    id: randomUUID(),
    status: 'final',
    code: { coding: [{ system: field.code?.system, code: field.code?.code, display: field.code?.display }] },
  };
  if (ctx.subject) obs.subject = ctx.subject;
  if (ctx.authored) obs.effectiveDateTime = ctx.authored;
  switch (field.type) {
    case 'choice':
    case 'open-choice':
      obs.valueCodeableConcept = { coding: [{ code: (v as { code: string }).code, display: (v as { display?: string }).display }] };
      break;
    case 'quantity':
      obs.valueQuantity = { value: (v as { value?: number }).value, unit: (v as { unit?: string }).unit };
      break;
    case 'integer':
    case 'decimal':
      obs.valueQuantity = { value: v as number, unit: field.unit };
      break;
    case 'boolean':
      obs.valueBoolean = v as boolean;
      break;
    default:
      obs.valueString = String(v);
  }
  return obs as FhirResource;
}

export function extractResources(
  qr: QuestionnaireResponse,
  questionnaire: Questionnaire,
  ctx: ExtractionContext = {},
): ExtractionResult {
  const form = fromQuestionnaire(questionnaire);
  const answers: Answers = parseResponse(qr);
  const visible = computeVisibility(form, answers);
  const resources: FhirResource[] = [];

  for (const section of form.sections) {
    if (section.resourceType) {
      const resource: Record<string, unknown> = { resourceType: section.resourceType, id: randomUUID() };
      if (ctx.subject && SUBJECT_TYPES.has(section.resourceType)) resource.subject = ctx.subject;
      for (const field of section.fields) {
        if (visible.get(field.id) === false) continue;
        if (field.observationExtract) continue;
        const raw = answers[field.id];
        if (raw !== undefined && field.fhirPath) {
          const v = Array.isArray(raw) ? raw[0] : raw;
          setPath(resource, field.fhirPath, extractValue(field, v));
        }
      }
      resources.push(resource as FhirResource);
    }
    for (const field of section.fields) {
      if (field.observationExtract && visible.get(field.id) !== false) {
        const raw = answers[field.id];
        if (raw !== undefined) {
          const v = Array.isArray(raw) ? raw[0] : raw;
          resources.push(observationOf(field, v, ctx));
        }
      }
    }
  }

  const invalid: ExtractionResult['invalid'] = [];
  for (const r of resources) {
    const res = validateResource(r);
    if (!res.ok) invalid.push({ resource: r, outcome: res.outcome });
  }
  return { resources, invalid };
}
