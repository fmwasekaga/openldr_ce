import { OpenLdrError } from '@openldr/core';
import type { AggregateMapping, BuildOutput, DataValue, MappingSource, SkipRecord } from './types';

export function dispatchReportSource(source: MappingSource): { reportId: string; params?: Record<string, string> } {
  if (source.kind !== 'report') {
    throw new OpenLdrError(`unsupported mapping source kind '${(source as { kind: string }).kind}' (Slice A supports 'report')`);
  }
  return { reportId: source.reportId, params: source.params };
}

function isEmpty(v: unknown): boolean {
  return v === null || v === undefined || v === '';
}

export function buildDataValueSet(
  rows: Record<string, unknown>[],
  mapping: AggregateMapping,
  orgUnitMap: Map<string, string>,
  period: string,
): BuildOutput {
  const dataValues: DataValue[] = [];
  const skipped: SkipRecord[] = [];
  rows.forEach((row, i) => {
    const facility = row[mapping.orgUnitColumn];
    const orgUnit = typeof facility === 'string' ? orgUnitMap.get(facility) : undefined;
    if (!orgUnit) {
      skipped.push({ row: i, reason: `no orgUnit mapping for facility '${String(facility)}'` });
      return;
    }
    const rowPeriod = mapping.periodColumn && !isEmpty(row[mapping.periodColumn]) ? String(row[mapping.periodColumn]) : period;
    for (const col of mapping.columns) {
      const value = row[col.column];
      if (isEmpty(value)) continue;
      dataValues.push({
        dataElement: col.dataElement,
        ...(col.categoryOptionCombo ? { categoryOptionCombo: col.categoryOptionCombo } : {}),
        orgUnit,
        period: rowPeriod,
        value: String(value),
      });
    }
  });
  return { payload: { dataValues }, skipped };
}
