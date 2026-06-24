export type MappingSource = { kind: 'report'; reportId: string; params?: Record<string, string> };

export interface ColumnMapping {
  column: string;
  dataElement: string;
  categoryOptionCombo?: string;
}

export interface AggregateMapping {
  kind?: 'aggregate';
  id: string;
  name: string;
  source: MappingSource;
  orgUnitColumn: string;
  periodColumn?: string;
  columns: ColumnMapping[];
  /** Which connector (sink plugin + sealed credentials) this mapping pushes through. */
  connectorId?: string;
}

export interface DataValue {
  dataElement: string;
  categoryOptionCombo?: string;
  orgUnit: string;
  period: string;
  value: string;
}

export interface DataValueSet {
  dataValues: DataValue[];
}

export interface SkipRecord {
  row: number;
  reason: string;
}

export interface BuildOutput {
  payload: DataValueSet;
  skipped: SkipRecord[];
}

export interface TrackerColumnMapping {
  column: string;
  dataElement: string;
}

export interface TrackerMapping {
  kind: 'tracker';
  id: string;
  name: string;
  source: { kind: 'event-source'; sourceId: string; params?: Record<string, string> };
  program: string;
  programStage: string;
  orgUnitColumn: string;
  eventDateColumn: string;
  idColumn: string;
  dataValues: TrackerColumnMapping[];
  /** Which connector (sink plugin + sealed credentials) this mapping pushes through. */
  connectorId?: string;
}

export type DhisMapping = AggregateMapping | TrackerMapping;

export interface TrackerEvent {
  event: string;
  program: string;
  programStage: string;
  orgUnit: string;
  occurredAt: string;
  dataValues: { dataElement: string; value: string }[];
}

export interface EventSet {
  events: TrackerEvent[];
}

export interface BuildEventsOutput {
  payload: EventSet;
  skipped: SkipRecord[];
}
