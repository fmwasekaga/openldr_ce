import type { Provenance } from '../provenance';
import type { Insertable } from 'kysely';
import type { V2LabResultsTable } from '../schema/external';
import { provColumns, codeable, referenceId, str, num } from '../flatten/extract';

export function projectObservation(r: Record<string, unknown>, prov: Provenance): Insertable<V2LabResultsTable> {
  const code = codeable(r['code']);
  const valueCc = codeable(r['valueCodeableConcept']);
  const quantity = r['valueQuantity'] as Record<string, unknown> | undefined;
  const interpretation = codeable((r['interpretation'] as unknown[] | undefined)?.[0]);
  const numericValue = num(quantity?.['value']);
  const textValue = valueCc.text ?? str(r['valueString']);
  const resultType = numericValue != null ? 'NM' : valueCc.code ? 'CE' : textValue ? 'ST' : null;
  return {
    id: String(r['id']),
    request_id: referenceId((r['basedOn'] as unknown[] | undefined)?.[0]),
    observation_code: code.code,
    observation_system: code.system,
    observation_desc: code.text,
    result_type: resultType,
    numeric_value: numericValue,
    numeric_units: str(quantity?.['unit']),
    coded_value: valueCc.code,
    text_value: textValue,
    abnormal_flag: interpretation.code,
    result_timestamp: str(r['effectiveDateTime']),
    ...provColumns(prov),
  };
}
