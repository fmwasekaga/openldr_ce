import { describe, it, expect } from 'vitest';
import { internalMigrations } from './internal/index';
import { externalMigrations } from './external/index';

describe('migration maps', () => {
  it('internal has the migrations with up/down', () => {
    expect(Object.keys(internalMigrations)).toEqual(['001_fhir_resources', '002_outbox', '003_ingest_batches', '004_plugins', '005_audit_events', '006_users', '007_terminology', '008_dhis2', '009_dhis2_schedules', '010_ingest_batch_config', '011_dashboards', '012_terminology_admin', '013_term_mappings', '014_value_sets', '015_ontology', '016_form_definitions', '017_reference_terminology_seeds', '018_snomed_code_system', '019_form_versions', '020_form_fhir_metadata', '021_user_profiles', '022_dhis2_metadata_cache', '023_marketplace_publishers', '024_plugin_registry', '025_report_runs', '026_report_schedules', '027_workflows', '028_workflow_runs', '029_workflow_schedules', '030_marketplace_installs', '031_workflow_datasets', '032_workflow_dataset_published', '033_connectors', '034_marketplace_registries', '035_plugin_data', '036_dhis2_to_plugin_data', '037_connectors_host_type', '038_app_settings', '039_workflow_runs_correlation', '040_report_templates', '041_custom_queries', '042_report_designs', '043_reports', '044_drop_report_templates', '045_fhir_schema', '046_fhir_versioning', '047_reference_change_log', '048_managed_origin', '049_terminology_managed_origin', '050_terminology_generation', '051_sync_sites', '052_sync_site_keys', '053_workflow_secrets', '054_sync_amendments', '055_sync_quarantine', '056_sync_divergences', '057_sync_site_cursors', '058_drop_reported_pull_cursor', '059_sync_activity']);
    for (const m of Object.values(internalMigrations)) {
      expect(typeof m.up).toBe('function');
      expect(typeof m.down).toBe('function');
    }
  });
  it('external has the flat_tables migration with up/down', () => {
    const ext = externalMigrations('postgres');
    expect(Object.keys(ext)).toEqual(['001_flat_tables', '002_specimen_origin', '003_v2_core', '004_v2_patients_facility', '005_v2_specimen_diagreport', '006_v2_amr_links', '007_drop_thin_rename_v2', '008_patients_merge']);
    expect(typeof ext['001_flat_tables'].up).toBe('function');
    expect(typeof ext['001_flat_tables'].down).toBe('function');
  });
});
