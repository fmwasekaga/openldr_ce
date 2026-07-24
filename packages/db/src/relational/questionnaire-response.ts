import type { Provenance } from '../provenance';
import type { Insertable } from 'kysely';
import type { QuestionnaireResponsesTable } from '../schema/external';
import { provColumns, referenceId, str } from './extract';

/** `urn:openldr:form:hiv_vl_documentation` -> `hiv_vl_documentation`; passes other
 *  canonical shapes through as-is (last path/colon segment). Null when absent. */
function formCode(questionnaire: unknown): string | null {
  const q = str(questionnaire);
  if (q === null) return null;
  const afterColon = q.includes(':') ? q.slice(q.lastIndexOf(':') + 1) : q;
  return afterColon.length > 0 ? afterColon : null;
}

export function projectQuestionnaireResponse(
  r: Record<string, unknown>,
  prov: Provenance,
): Insertable<QuestionnaireResponsesTable> {
  const items = r['item'];
  return {
    id: String(r['id']),
    questionnaire: str(r['questionnaire']),
    form_code: formCode(r['questionnaire']),
    subject_id: referenceId(r['subject']),
    authored: str(r['authored']),
    based_on_id: referenceId((r['basedOn'] as unknown[] | undefined)?.[0]),
    items: Array.isArray(items) ? JSON.stringify(items) : null,
    ...provColumns(prov),
  };
}
