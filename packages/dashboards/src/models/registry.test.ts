import { describe, it, expect } from 'vitest';
import { listModels, getModel } from './registry';
import { exposableColumns, type QueryModel } from './registry';

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
    expect(cols).toContain('managing_organization');
    expect(cols).toContain('sex');
    expect(cols).not.toContain('surname');
    expect(cols).not.toContain('national_id');
  });

  it('fail-safe: an optional join with NO denyColumns exposes nothing', () => {
    expect(exposableColumns(MODEL_WITH_OPTIONAL, 'jf')).toEqual([]);
  });

  it('returns [] for a non-optional join alias', () => {
    expect(exposableColumns(MODEL_WITH_OPTIONAL, 'jauto')).toEqual([]);
  });

  it('returns [] for an unknown alias', () => {
    expect(exposableColumns(MODEL_WITH_OPTIONAL, 'nope')).toEqual([]);
  });
});
