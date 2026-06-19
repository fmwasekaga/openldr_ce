import type { FhirResource, Questionnaire, QuestionnaireResponse } from '@openldr/fhir';
import { ObservationExtractor, ServiceRequestExtractor } from '@openldr/forms';
import type { Converter } from '../converter';

const decoder = new TextDecoder();

export const questionnaireResponseConverter: Converter = {
  id: 'questionnaire-response',
  version: '1',
  async convert(raw): Promise<FhirResource[]> {
    const data = JSON.parse(decoder.decode(raw)) as { questionnaire?: Questionnaire; response?: QuestionnaireResponse };
    if (!data.questionnaire || !data.response) {
      throw new Error('payload must be { questionnaire, response }');
    }
    const ctx = {};
    const resources = [
      ...ObservationExtractor.extract(data.response, data.questionnaire, ctx),
      ...ServiceRequestExtractor.extract(data.response, data.questionnaire, ctx),
    ] as unknown as FhirResource[];
    return resources;
  },
};
