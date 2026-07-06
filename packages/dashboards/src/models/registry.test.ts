import { describe, it, expect } from 'vitest';
import { listModels, getModel } from './registry';

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
    expect(d!.column).toBe('birth_date');
    expect(d!.compute).toMatchObject({ kind: 'age-band', openEndedLabel: '50+', unknownLabel: 'unknown' });
    expect(d!.compute!.bands.map((b) => b.label)).toEqual(['0-4', '5-14', '15-24', '25-49']);
  });
});

describe('observations facility join', () => {
  it('declares a patients join and a facility dimension sourced from it', () => {
    const m = getModel('observations')!;
    const join = (m.joins ?? []).find((j) => j.alias === 'jp');
    expect(join).toMatchObject({ table: 'patients', alias: 'jp', left: 'subject_ref', leftReplace: ['Patient/', ''], right: 'id' });
    const facility = m.dimensions.find((d) => d.key === 'facility');
    expect(facility).toMatchObject({ key: 'facility', column: 'managing_organization', join: 'jp' });
  });
});
