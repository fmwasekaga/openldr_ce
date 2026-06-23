import { describe, it, expect } from 'vitest';
import { internalMigrations } from './internal/index';
import { externalMigrations } from './external/index';

describe('migration maps', () => {
  it('internal has the migrations with up/down', () => {
    expect(Object.keys(internalMigrations)).toEqual(['001_fhir_resources', '002_outbox', '003_ingest_batches', '004_plugins', '005_audit_events', '006_users', '007_terminology', '008_dhis2', '009_dhis2_schedules', '010_ingest_batch_config', '011_dashboards', '012_terminology_admin', '013_term_mappings', '014_value_sets', '015_ontology', '016_form_definitions', '017_reference_terminology_seeds', '018_snomed_code_system', '019_form_versions', '020_form_fhir_metadata', '021_user_profiles', '022_dhis2_metadata_cache', '023_marketplace_publishers', '024_plugin_registry', '025_report_runs', '026_report_schedules', '027_workflows']);
    for (const m of Object.values(internalMigrations)) {
      expect(typeof m.up).toBe('function');
      expect(typeof m.down).toBe('function');
    }
  });
  it('external has the flat_tables migration with up/down', () => {
    const ext = externalMigrations('postgres');
    expect(Object.keys(ext)).toEqual(['001_flat_tables', '002_specimen_origin']);
    expect(typeof ext['001_flat_tables'].up).toBe('function');
    expect(typeof ext['001_flat_tables'].down).toBe('function');
  });
});
