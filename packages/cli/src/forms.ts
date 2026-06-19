import { readFileSync } from 'node:fs';
import { createAppContext } from '@openldr/bootstrap';
import { loadConfig } from '@openldr/config';
import { ObservationExtractor, ServiceRequestExtractor, toTransactionBundle, type ExtractionContext } from '@openldr/forms';
import type { Questionnaire, QuestionnaireResponse } from '@openldr/fhir';

export interface FormsExtractOutput {
  resourceTypes: string[];
  invalidCount: number;
  bundle: unknown;
}

export function runFormsExtract(questionnairePath: string, responsePath: string, ctx: ExtractionContext = {}): FormsExtractOutput {
  const questionnaire = JSON.parse(readFileSync(questionnairePath, 'utf8')) as Questionnaire;
  const response = JSON.parse(readFileSync(responsePath, 'utf8')) as QuestionnaireResponse;
  // The ported extractors are typed against `fhir/r4`; our CLI reads `@openldr/fhir`
  // resources, which are structurally compatible JSON — bridge the type boundary.
  const q = questionnaire as never;
  const qr = response as never;
  const resources = [...ObservationExtractor.extract(qr, q, ctx), ...ServiceRequestExtractor.extract(qr, q, ctx)];
  return {
    resourceTypes: resources.map((r) => r.resourceType),
    invalidCount: 0,
    bundle: toTransactionBundle(qr, resources),
  };
}

export async function runFormsList(opts: { json: boolean }): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try {
    const forms = await ctx.forms.list();
    if (opts.json) {
      process.stdout.write(JSON.stringify(forms, null, 2) + '\n');
    } else {
      const lines = forms.map(
        (form) =>
          `${form.id}\t${form.name}\t${form.status}\t${form.active ? 'active' : 'inactive'}\t${form.fhirResourceType ?? ''}\t${form.fieldCount}\t${form.versionLabel ?? ''}`,
      );
      process.stdout.write((lines.length ? lines.join('\n') : '(no forms)') + '\n');
    }
    return 0;
  } finally {
    await ctx.close();
  }
}
