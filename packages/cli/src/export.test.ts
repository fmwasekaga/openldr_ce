import { describe, it, expect } from 'vitest';
import { toNdjson, toBundle, buildManifest } from './export';
import type { FhirResource } from '@openldr/fhir';

const resources: FhirResource[] = [
  { resourceType: 'Patient', id: 'p1' },
  { resourceType: 'Observation', id: 'o1' },
];

describe('toNdjson', () => {
  it('emits one JSON object per line with a trailing newline', () => {
    const out = toNdjson(resources);
    expect(out.trimEnd().split('\n')).toHaveLength(2);
    expect(JSON.parse(out.trimEnd().split('\n')[0]).resourceType).toBe('Patient');
    expect(out.endsWith('\n')).toBe(true);
  });
  it('returns empty string for no resources', () => {
    expect(toNdjson([])).toBe('');
  });
});

describe('toBundle', () => {
  it('wraps resources in a collection Bundle', () => {
    const b = toBundle(resources);
    expect(b.resourceType).toBe('Bundle');
    expect(b.type).toBe('collection');
    expect(b.entry).toHaveLength(2);
    expect(b.entry[0].resource.id).toBe('p1');
  });
});

describe('buildManifest', () => {
  it('counts resources and tables', () => {
    const m = buildManifest(resources, [{ table: 'patients', columns: ['id'], rows: [{ id: 'p1' }] }, { table: 'observations', columns: ['id'], rows: [] }], '2026-01-01T00:00:00Z');
    expect(m.fhirResourceCount).toBe(2);
    expect(m.tables).toEqual({ patients: 1, observations: 0 });
    expect(m.formats).toContain('csv');
    expect(m.generatedAt).toBe('2026-01-01T00:00:00Z');
  });
});
