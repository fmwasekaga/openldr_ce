import type { TargetMetadata } from '@openldr/ports';
import type { AggregateMapping } from './types';

export function validateMapping(mapping: AggregateMapping, metadata: TargetMetadata): string[] {
  const des = new Set(metadata.dataElements.map((d) => d.id));
  const cocs = new Set(metadata.categoryOptionCombos.map((c) => c.id));
  const problems: string[] = [];
  for (const col of mapping.columns) {
    if (!des.has(col.dataElement)) problems.push(`unknown dataElement '${col.dataElement}' (column '${col.column}')`);
    if (col.categoryOptionCombo && !cocs.has(col.categoryOptionCombo)) {
      problems.push(`unknown categoryOptionCombo '${col.categoryOptionCombo}' (column '${col.column}')`);
    }
  }
  return problems;
}
