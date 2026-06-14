export type MappingSource = { kind: 'report'; reportId: string; params?: Record<string, string> };

export interface ColumnMapping {
  column: string;
  dataElement: string;
  categoryOptionCombo?: string;
}

export interface AggregateMapping {
  id: string;
  name: string;
  source: MappingSource;
  orgUnitColumn: string;
  periodColumn?: string;
  columns: ColumnMapping[];
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
