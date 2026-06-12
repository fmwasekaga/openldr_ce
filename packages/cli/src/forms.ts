import { readFileSync } from 'node:fs';
import { extractResources, toTransactionBundle, type ExtractionContext } from '@openldr/forms';
import type { Questionnaire, QuestionnaireResponse } from '@openldr/fhir';

export interface FormsExtractOutput {
  resourceTypes: string[];
  invalidCount: number;
  bundle: unknown;
}

export function runFormsExtract(questionnairePath: string, responsePath: string, ctx: ExtractionContext = {}): FormsExtractOutput {
  const questionnaire = JSON.parse(readFileSync(questionnairePath, 'utf8')) as Questionnaire;
  const response = JSON.parse(readFileSync(responsePath, 'utf8')) as QuestionnaireResponse;
  const { resources, invalid } = extractResources(response, questionnaire, ctx);
  return {
    resourceTypes: resources.map((r) => r.resourceType),
    invalidCount: invalid.length,
    bundle: toTransactionBundle(resources),
  };
}
