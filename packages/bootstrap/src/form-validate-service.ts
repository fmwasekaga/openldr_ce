import {
  validateAnswers,
  toQuestionnaire,
  toQuestionnaireResponse,
  ObservationExtractor,
  ServiceRequestExtractor,
  type FormSchema,
} from '@openldr/forms';
import type { RunFormValidateInput, RunFormValidateOutput, WorkflowItem } from '@openldr/workflows';

export interface FormValidateServiceDeps {
  forms: { get(id: string): Promise<{ schema: FormSchema } | null> };
}

/**
 * Validate each input item's `json` (treated as form answers) against the chosen
 * form. Valid items become extracted FHIR resource items (Observation/ServiceRequest);
 * invalid items are dropped and recorded in `meta.invalid` with per-field reasons.
 */
export function createFormValidateService(
  deps: FormValidateServiceDeps,
): (input: RunFormValidateInput) => Promise<RunFormValidateOutput> {
  return async ({ formId, items }) => {
    const def = await deps.forms.get(formId);
    if (!def) throw new Error(`Form not found: ${formId}`);
    const model = def.schema;
    const questionnaire = toQuestionnaire(model);

    const out: WorkflowItem[] = [];
    const invalid: RunFormValidateOutput['meta']['invalid'] = [];
    let validated = 0;

    items.forEach((item, index) => {
      const answers = item.json;
      const errs = validateAnswers(model, answers);
      if (errs.length > 0) {
        invalid.push({ index, errors: errs.map((e) => ({ fieldId: e.fieldId, reason: e.reason })) });
        return;
      }
      validated += 1;
      const response = toQuestionnaireResponse(model, answers);
      const resources = [
        ...ObservationExtractor.extract(response, questionnaire, {}),
        ...ServiceRequestExtractor.extract(response, questionnaire, {}),
      ];
      for (const r of resources) out.push({ json: r as unknown as Record<string, unknown> });
    });

    return { items: out, meta: { formId, validated, invalid } };
  };
}
