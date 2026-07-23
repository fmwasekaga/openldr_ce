import { describe, it, expect } from 'vitest';
import { listModels, getModel, exposableColumns, modelsForClient, type QueryModel } from './registry';

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
    expect(d!.compute!.bands.map((b) => b.label)).toEqual(['0-4', '5-14', '15-24', '25-49']);
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
  it('returns table columns minus denyColumns for a configured optional join', () => {
    const cols = exposableColumns(MODEL_WITH_OPTIONAL, 'jp');
    expect(cols).toEqual(['id', 'sex', 'managing_organization', 'active', 'replaced_by_id', 'source_system', 'plugin_id', 'plugin_version', 'batch_id', 'created_at']);
  });

  it('fail-safe: an optional join with NO denyColumns exposes nothing', () => {
    expect(exposableColumns(MODEL_WITH_OPTIONAL, 'jf')).toEqual([]);
  });

  it('fail-safe: an optional join with an EMPTY denyColumns exposes nothing', () => {
    const model = { ...MODEL_WITH_OPTIONAL, joins: [{ table: 'patients', alias: 'je', left: 'patient_id', right: 'id', optional: true, denyColumns: [] as string[] }] } as QueryModel;
    expect(exposableColumns(model, 'je')).toEqual([]);
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

  it('keeps only optional joins with a usable denylist, dropping non-optional and undenied joins', () => {
    const [m] = modelsForClient([MODEL_WITH_OPTIONAL]);
    expect(m.optionalJoins?.map((j) => j.alias)).toEqual(['jp']); // jf (no denylist) and jauto (not optional) dropped
  });

  it('includes the admin-declared join keys (left/right) for read-only display', () => {
    const m = modelsForClient().find((x) => x.id === 'service_requests')!;
    const oj = m.optionalJoins!.find((x) => x.alias === 'jp')!;
    expect(oj.left).toBe('patient_id');
    expect(oj.right).toBe('id');
  });
});
