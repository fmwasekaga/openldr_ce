import { describe, it, expect } from 'vitest';
import { internalMigrations } from './internal/index';
import { externalMigrations } from './external/index';

describe('migration maps', () => {
  it('internal has the fhir_resources migration with up/down', () => {
    expect(Object.keys(internalMigrations)).toEqual(['001_fhir_resources']);
    expect(typeof internalMigrations['001_fhir_resources'].up).toBe('function');
    expect(typeof internalMigrations['001_fhir_resources'].down).toBe('function');
  });
  it('external has the flat_tables migration with up/down', () => {
    expect(Object.keys(externalMigrations)).toEqual(['001_flat_tables']);
    expect(typeof externalMigrations['001_flat_tables'].up).toBe('function');
    expect(typeof externalMigrations['001_flat_tables'].down).toBe('function');
  });
});
