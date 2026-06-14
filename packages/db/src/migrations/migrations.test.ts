import { describe, it, expect } from 'vitest';
import { internalMigrations } from './internal/index';
import { externalMigrations } from './external/index';

describe('migration maps', () => {
  it('internal has the six migrations with up/down', () => {
    expect(Object.keys(internalMigrations)).toEqual(['001_fhir_resources', '002_outbox', '003_ingest_batches', '004_plugins', '005_audit_events', '006_users', '007_terminology']);
    for (const m of Object.values(internalMigrations)) {
      expect(typeof m.up).toBe('function');
      expect(typeof m.down).toBe('function');
    }
  });
  it('external has the flat_tables migration with up/down', () => {
    const ext = externalMigrations('postgres');
    expect(Object.keys(ext)).toEqual(['001_flat_tables']);
    expect(typeof ext['001_flat_tables'].up).toBe('function');
    expect(typeof ext['001_flat_tables'].down).toBe('function');
  });
});
