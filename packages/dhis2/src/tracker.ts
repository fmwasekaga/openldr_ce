import type { TargetMetadata } from '@openldr/ports';
import { dhis2Uid } from './uid';
import type { BuildEventsOutput, SkipRecord, TrackerEvent, TrackerMapping } from './types';

function isEmpty(v: unknown): boolean { return v === null || v === undefined || v === ''; }

export function buildEvents(rows: Record<string, unknown>[], mapping: TrackerMapping, orgUnitMap: Map<string, string>): BuildEventsOutput {
  const events: TrackerEvent[] = [];
  const skipped: SkipRecord[] = [];
  rows.forEach((row, i) => {
    const facility = row[mapping.orgUnitColumn];
    const orgUnit = typeof facility === 'string' ? orgUnitMap.get(facility) : undefined;
    if (!orgUnit) { skipped.push({ row: i, reason: `no orgUnit mapping for facility '${String(facility)}'` }); return; }
    const occurredAt = row[mapping.eventDateColumn];
    if (isEmpty(occurredAt)) { skipped.push({ row: i, reason: `missing eventDate column '${mapping.eventDateColumn}'` }); return; }
    const recordKey = row[mapping.idColumn];
    if (isEmpty(recordKey)) { skipped.push({ row: i, reason: `missing idColumn '${mapping.idColumn}'` }); return; }
    const dataValues = mapping.dataValues
      .filter((c) => !isEmpty(row[c.column]))
      .map((c) => ({ dataElement: c.dataElement, value: String(row[c.column]) }));
    events.push({
      event: dhis2Uid(`${mapping.id}:${String(recordKey)}`),
      program: mapping.program,
      programStage: mapping.programStage,
      orgUnit,
      occurredAt: String(occurredAt),
      dataValues,
    });
  });
  return { payload: { events }, skipped };
}

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
