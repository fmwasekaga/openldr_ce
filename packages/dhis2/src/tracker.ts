import type { TargetMetadata } from '@openldr/ports';
import type { TrackerMapping } from './types';

export function validateTrackerMapping(mapping: TrackerMapping, metadata: TargetMetadata): string[] {
  const programs = new Set((metadata.programs ?? []).map((p) => p.id));
  const stages = new Set((metadata.programStages ?? []).map((s) => s.id));
  const des = new Set(metadata.dataElements.map((d) => d.id));
  const problems: string[] = [];
  if (!programs.has(mapping.program)) problems.push(`unknown program '${mapping.program}'`);
  if (!stages.has(mapping.programStage)) problems.push(`unknown programStage '${mapping.programStage}'`);
  for (const c of mapping.dataValues) if (!des.has(c.dataElement)) problems.push(`unknown dataElement '${c.dataElement}' (column '${c.column}')`);
  return problems;
}
