import type { Provenance } from '../provenance';
import type { Insertable } from 'kysely';
import type { ObservationsTable } from '../schema/external';
import { provColumns, firstIdentifier, codeable, reference, str, num } from './extract';

export function flattenObservation(r: Record<string, unknown>, prov: Provenance): Insertable<ObservationsTable> {
  const idn = firstIdentifier(r);
  const code = codeable(r['code']);
  const valueCc = codeable(r['valueCodeableConcept']);
  const quantity = r['valueQuantity'] as Record<string, unknown> | undefined;
  const interpretation = codeable((r['interpretation'] as unknown[] | undefined)?.[0]);
  return {
    id: String(r['id']),
    identifier_value: idn.value,
    status: str(r['status']),
    code_code: code.code,
    code_text: code.text,
    subject_ref: reference(r['subject']),
    specimen_ref: reference(r['specimen']),
    value_quantity: num(quantity?.['value']),
    value_unit: str(quantity?.['unit']),
    value_code: valueCc.code,
    value_text: valueCc.text ?? str(r['valueString']),
    interpretation_code: interpretation.code,
    effective_date_time: str(r['effectiveDateTime']),
    ...provColumns(prov),
  };
}
