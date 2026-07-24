import { describe, it, expect } from 'vitest';
import { listModels, getModel, exposableColumns, exposableFor, modelsForClient, type QueryModel, JOINABLE_TABLES, joinableColumns, getJoinableTable, joinableTablesForClient, HARDCODED_DENY_UNION, PII_COLUMNS, tableExposableColumns, type ColumnPolicy } from './registry';

describe('model registry', () => {
  it('exposes service_requests with count metric and date dimension', () => {
    const m = getModel('service_requests');
    expect(m).toBeDefined();
    expect(m!.metrics.some((x) => x.agg === 'count')).toBe(true);
    const authored = m!.dimensions.find((d) => d.key === 'authored_on');
    expect(authored?.kind).toBe('date');
    expect(authored?.dateGrain).toContain('month');
  });
  it('every dimension key is unique per model', () => {
    for (const m of listModels()) {
      const cols = m.dimensions.map((d) => d.key);
      expect(new Set(cols).size).toBe(cols.length);
    }
  });
  it('every metric key is unique per model', () => {
    for (const m of listModels()) {
      const keys = m.metrics.map((x) => x.key);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });
});

describe('patients age_band computed dimension', () => {
  it('exposes an age_band dimension with an age-band compute config', () => {
    const m = getModel('patients')!;
    const d = m.dimensions.find((x) => x.key === 'age_band');
    expect(d).toBeDefined();
    expect(d!.column).toBe('date_of_birth');
    expect(d!.compute).toMatchObject({ kind: 'age-band', openEndedLabel: '50+', unknownLabel: 'unknown' });
    const compute = d!.compute!;
    if (compute.kind !== 'age-band') throw new Error('expected age-band compute');
    expect(compute.bands.map((b) => b.label)).toEqual(['0-4', '5-14', '15-24', '25-49']);
  });
});

describe('observations facility join', () => {
  it('declares a patients join and a facility dimension sourced from it', () => {
    const m = getModel('observations')!;
    const join = (m.joins ?? []).find((j) => j.alias === 'jp');
    expect(join).toMatchObject({ table: 'patients', alias: 'jp', left: 'patient_id', right: 'id' });
    expect(join).not.toHaveProperty('leftReplace');
    const facility = m.dimensions.find((d) => d.key === 'facility');
    expect(facility).toMatchObject({ key: 'facility', column: 'managing_organization', join: 'jp' });
  });
});

const MODEL_WITH_OPTIONAL: QueryModel = {
  id: 'm', label: 'M', table: 'lab_requests',
  dimensions: [],
  metrics: [{ key: 'count', label: 'Count', agg: 'count' }],
  joins: [
    { table: 'patients', alias: 'jp', left: 'patient_id', right: 'id',
      optional: true, denyColumns: ['surname', 'firstname', 'national_id', 'phone', 'email', 'patient_guid', 'date_of_birth'] },
    { table: 'facilities', alias: 'jf', left: 'facility_id', right: 'id', optional: true }, // no denyColumns → unavailable
    { table: 'patients', alias: 'jauto', left: 'patient_id', right: 'id' },                 // not optional
  ],
};

describe('exposableColumns', () => {
  it('returns table columns minus the HARDCODED_DENY_UNION fallback for a configured optional join', () => {
    const cols = exposableColumns(MODEL_WITH_OPTIONAL, 'jp');
    expect(cols).toEqual(['sex', 'managing_organization', 'active', 'source_system', 'created_at']);
  });

  it('exposed-by-default: an optional join with NO local denyColumns still falls back to the union', () => {
    const cols = exposableColumns(MODEL_WITH_OPTIONAL, 'jf');
    expect(cols).not.toEqual([]);
    expect(cols).toContain('facility_name');
    expect(cols).not.toContain('plugin_id'); // still denied via HARDCODED_DENY_UNION.facilities
  });

  it('exposed-by-default: a local denyColumns field is no longer read (union fallback applies instead)', () => {
    const model = { ...MODEL_WITH_OPTIONAL, joins: [{ table: 'patients', alias: 'je', left: 'patient_id', right: 'id', optional: true, denyColumns: [] as string[] }] } as QueryModel;
    const cols = exposableColumns(model, 'je');
    expect(cols).not.toEqual([]);
    expect(cols).not.toContain('national_id'); // still denied via HARDCODED_DENY_UNION.patients
  });

  it('returns [] for a non-optional join alias', () => {
    expect(exposableColumns(MODEL_WITH_OPTIONAL, 'jauto')).toEqual([]);
  });

  it('returns [] for an unknown alias', () => {
    expect(exposableColumns(MODEL_WITH_OPTIONAL, 'nope')).toEqual([]);
  });
});

describe('service_requests demo optional join', () => {
  it('declares an optional patients join with a PII denylist', () => {
    const j = (getModel('service_requests')!.joins ?? []).find((x) => x.alias === 'jp');
    expect(j?.optional).toBe(true);
    expect(j?.denyColumns).toEqual(expect.arrayContaining(['surname', 'firstname', 'national_id']));
  });
});

describe('observations optional relationships', () => {
  it('offers specimens (js) and lab_requests (jr) as optional relationships, denylist-filtered', () => {
    const m = modelsForClient().find((x) => x.id === 'observations')!;
    const aliases = (m.optionalJoins ?? []).map((j) => j.alias).sort();
    expect(aliases).toEqual(['jr', 'js']);
    const js = m.optionalJoins!.find((j) => j.alias === 'js')!;
    expect(js).toMatchObject({ label: 'Specimen', left: 'specimen_id', right: 'id' });
    expect(js.exposableColumns).toEqual(['received_time', 'status', 'type_code', 'type_text', 'origin', 'created_at']);
    expect(js.exposableColumns).not.toContain('patient_id'); // denied
    const jr = m.optionalJoins!.find((j) => j.alias === 'jr')!;
    expect(jr).toMatchObject({ label: 'Request', left: 'request_id', right: 'request_id' });
    expect(jr.exposableColumns).toContain('panel_desc');
    expect(jr.exposableColumns).not.toContain('patient_id'); // denied
  });

  it('does not expose the non-optional patients join (jp) as user-pickable', () => {
    const m = modelsForClient().find((x) => x.id === 'observations')!;
    expect((m.optionalJoins ?? []).some((j) => j.alias === 'jp')).toBe(false);
  });
});

describe('observations numeric value dimension', () => {
  it('exposes numeric_value as a number-kind dimension', () => {
    const d = getModel('observations')!.dimensions.find((x) => x.key === 'value');
    expect(d).toMatchObject({ label: 'Value', column: 'numeric_value', kind: 'number' });
  });
});

describe('modelsForClient', () => {
  it('projects optional joins to {alias,label,exposableColumns} and omits raw joins/denyColumns', () => {
    const m = modelsForClient().find((x) => x.id === 'service_requests')!;
    expect((m as unknown as Record<string, unknown>).joins).toBeUndefined();
    const oj = m.optionalJoins!.find((x) => x.alias === 'jp')!;
    expect(oj.label).toBe('Patient');
    expect(oj.exposableColumns).toEqual(['sex', 'managing_organization', 'active', 'source_system', 'created_at']);
  });

  it('omits optionalJoins for models without optional joins', () => {
    const m = modelsForClient().find((x) => x.id === 'diagnostic_reports')!;
    expect(m.optionalJoins).toBeUndefined();
  });

  it('keeps optional joins exposed-by-default, dropping only the non-optional join', () => {
    const [m] = modelsForClient([MODEL_WITH_OPTIONAL]);
    const aliases = m.optionalJoins?.map((j) => j.alias) ?? [];
    expect(aliases).toContain('jp'); // has an explicit (now-ignored) local denylist; still exposed via the union fallback
    expect(aliases).toContain('jf'); // no local denylist -> exposed-by-default via the union fallback, no longer dropped
    expect(aliases).not.toContain('jauto'); // not optional -> never user-pickable
  });

  it('includes the admin-declared join keys (left/right) for read-only display', () => {
    const m = modelsForClient().find((x) => x.id === 'service_requests')!;
    const oj = m.optionalJoins!.find((x) => x.alias === 'jp')!;
    expect(oj.left).toBe('patient_id');
    expect(oj.right).toBe('id');
  });
});

describe('joinable tables (arbitrary joins)', () => {
  it('joinableColumns applies a denylist policy (all-minus-deny)', () => {
    const patients = getJoinableTable('patients')!;
    const cols = joinableColumns(patients);
    expect(cols).toContain('sex');
    expect(cols).not.toContain('national_id'); // PII denied
    expect(cols).not.toContain('surname');
  });

  it('joinableColumns falls back to the union when the policy has no entry (exposed-by-default, but real PII stays hidden)', () => {
    const cols = joinableColumns(getJoinableTable('patients')!);
    expect(cols).not.toContain('national_id');
  });

  it('joinableTablesForClient ships policy-filtered columns + PKs + allColumns, never the raw denylist', () => {
    const p = joinableTablesForClient().find((t) => t.table === 'patients')!;
    expect(p.columns).not.toContain('national_id');
    expect(p.primaryKeys).toEqual(['id']);
    expect(p.allColumns).toContain('national_id'); // allColumns = every real column, for key pickers
    expect((p as any).denyColumns).toBeUndefined();
  });

  it('modelsForClient includes the base table columns for the left-key picker', () => {
    const m = modelsForClient().find((x) => x.id === 'service_requests')!;
    expect(m.tableColumns).toContain('patient_id');
  });
});

describe('exposableFor', () => {
  it('returns a synthesized join\'s explicit exposable list', () => {
    const model = { id: 'm', label: 'M', table: 'lab_requests',
      joins: [{ table: 'patients', alias: 'u1', left: 'patient_id', right: 'id', optional: true, exposable: ['sex'] }],
      dimensions: [], metrics: [] } as any;
    expect(exposableFor(model, 'u1')).toEqual(['sex']);
  });
  it('falls back to exposableColumns for an admin optional join', () => {
    const m = getModel('service_requests')!;
    expect(exposableFor(m, 'jp')).toEqual(exposableColumns(m, 'jp'));
  });
});

describe('policy-aware exposure', () => {
  it('HARDCODED_DENY_UNION is the per-table union of every hardcoded denylist', () => {
    expect(new Set(HARDCODED_DENY_UNION.patients)).toEqual(new Set([
      'id', 'patient_guid', 'surname', 'firstname', 'national_id', 'phone', 'email',
      'date_of_birth', 'replaced_by_id', 'plugin_id', 'plugin_version', 'batch_id',
    ]));
    // source_system unioned in from the per-model specimen/request joins:
    expect(HARDCODED_DENY_UNION.specimens).toContain('source_system');
    expect(HARDCODED_DENY_UNION.lab_requests).toContain('source_system');
  });

  it('tableExposableColumns falls back to the union when the policy has no entry', () => {
    expect(tableExposableColumns('patients')).toContain('sex');
    expect(tableExposableColumns('patients')).not.toContain('national_id');
  });

  it('tableExposableColumns honors an explicit policy (exposed-by-default)', () => {
    const policy: ColumnPolicy = new Map([['patients', new Set(['sex'])]]);
    const cols = tableExposableColumns('patients', policy);
    expect(cols).not.toContain('sex');       // hidden by policy
    expect(cols).toContain('national_id');   // NOT in policy => exposed (no floor)
  });

  it('PII_COLUMNS flags patient identifiers', () => {
    expect(PII_COLUMNS.patients).toEqual(expect.arrayContaining(['national_id', 'phone', 'surname']));
  });
});
