import type { Migration } from 'kysely';
import * as m001 from './001_fhir_resources';
import * as m002 from './002_outbox';
import * as m003 from './003_ingest_batches';
import * as m004 from './004_plugins';
import * as m005 from './005_audit_events';
import * as m006 from './006_users';
import * as m007 from './007_terminology';
import * as m008 from './008_dhis2';
import * as m009 from './009_dhis2_schedules';
import * as m010 from './010_ingest_batch_config';
import * as m011 from './011_dashboards';
import * as m012 from './012_terminology_admin';
import * as m013 from './013_term_mappings';
import * as m014 from './014_value_sets';
import * as m015 from './015_ontology';
import * as m016 from './016_form_definitions';
import * as m017 from './017_reference_terminology_seeds';
import * as m018 from './018_snomed_code_system';
import * as m019 from './019_form_versions';
import * as m020 from './020_form_fhir_metadata';
import * as m021 from './021_user_profiles';
import * as m022 from './022_dhis2_metadata_cache';
import * as m023 from './023_marketplace_publishers';
import * as m024 from './024_plugin_registry';
import * as m025 from './025_report_runs';
import * as m026 from './026_report_schedules';
import * as m027 from './027_workflows';
import * as m028 from './028_workflow_runs';
import * as m029 from './029_workflow_schedules';
import * as m030 from './030_marketplace_installs';
import * as m031 from './031_workflow_datasets';
import * as m032 from './032_workflow_dataset_published';
import * as m033 from './033_connectors';
import * as m034 from './034_marketplace_registries';
import * as m035 from './035_plugin_data';
import * as m036 from './036_dhis2_to_plugin_data';
import * as m037 from './037_connectors_host_type';
import * as m038 from './038_app_settings';
import * as m039 from './039_workflow_runs_correlation';
import * as m040 from './040_report_templates';
import * as m041 from './041_custom_queries';
import * as m042 from './042_report_designs';
import * as m043 from './043_reports';
import * as m044 from './044_drop_report_templates';
import * as m045 from './045_fhir_schema';
import * as m046 from './046_fhir_versioning';
import * as m047 from './047_reference_change_log';
import * as m048 from './048_managed_origin';
import * as m049 from './049_terminology_managed_origin';
import * as m050 from './050_terminology_generation';
import * as m051 from './051_sync_sites';
import * as m052 from './052_sync_site_keys';
import * as m053 from './053_workflow_secrets';
import * as m054 from './054_sync_amendments';
import * as m055 from './055_sync_quarantine';
import * as m056 from './056_sync_divergences';
import * as m057 from './057_sync_site_cursors';
import * as m058 from './058_drop_reported_pull_cursor';
import * as m059 from './059_sync_activity';
import * as m060 from './060_notifications';
import * as m061 from './061_terminology_ingest_jobs';
import * as m062 from './062_rbac';

export const internalMigrations: Record<string, Migration> = {
  '001_fhir_resources': { up: m001.up, down: m001.down },
  '002_outbox': { up: m002.up, down: m002.down },
  '003_ingest_batches': { up: m003.up, down: m003.down },
  '004_plugins': { up: m004.up, down: m004.down },
  '005_audit_events': { up: m005.up, down: m005.down },
  '006_users': { up: m006.up, down: m006.down },
  '007_terminology': { up: m007.up, down: m007.down },
  '008_dhis2': { up: m008.up, down: m008.down },
  '009_dhis2_schedules': { up: m009.up, down: m009.down },
  '010_ingest_batch_config': { up: m010.up, down: m010.down },
  '011_dashboards': { up: m011.up, down: m011.down },
  '012_terminology_admin': { up: m012.up, down: m012.down },
  '013_term_mappings': { up: m013.up, down: m013.down },
  '014_value_sets': { up: m014.up, down: m014.down },
  '015_ontology': { up: m015.up, down: m015.down },
  '016_form_definitions': { up: m016.up, down: m016.down },
  '017_reference_terminology_seeds': { up: m017.up, down: m017.down },
  '018_snomed_code_system': { up: m018.up, down: m018.down },
  '019_form_versions': { up: m019.up, down: m019.down },
  '020_form_fhir_metadata': { up: m020.up, down: m020.down },
  '021_user_profiles': { up: m021.up, down: m021.down },
  '022_dhis2_metadata_cache': { up: m022.up, down: m022.down },
  '023_marketplace_publishers': { up: m023.up, down: m023.down },
  '024_plugin_registry': { up: m024.up, down: m024.down },
  '025_report_runs': { up: m025.up, down: m025.down },
  '026_report_schedules': { up: m026.up, down: m026.down },
  '027_workflows': { up: m027.up, down: m027.down },
  '028_workflow_runs': { up: m028.up, down: m028.down },
  '029_workflow_schedules': { up: m029.up, down: m029.down },
  '030_marketplace_installs': { up: m030.up, down: m030.down },
  '031_workflow_datasets': { up: m031.up, down: m031.down },
  '032_workflow_dataset_published': { up: m032.up, down: m032.down },
  '033_connectors': { up: m033.up, down: m033.down },
  '034_marketplace_registries': { up: m034.up, down: m034.down },
  '035_plugin_data': { up: m035.up, down: m035.down },
  '036_dhis2_to_plugin_data': { up: m036.up, down: m036.down },
  '037_connectors_host_type': { up: m037.up, down: m037.down },
  '038_app_settings': { up: m038.up, down: m038.down },
  '039_workflow_runs_correlation': { up: m039.up, down: m039.down },
  '040_report_templates': { up: m040.up, down: m040.down },
  '041_custom_queries': { up: m041.up, down: m041.down },
  '042_report_designs': { up: m042.up, down: m042.down },
  '043_reports': { up: m043.up, down: m043.down },
  '044_drop_report_templates': { up: m044.up, down: m044.down },
  '045_fhir_schema': { up: m045.up, down: m045.down },
  '046_fhir_versioning': { up: m046.up, down: m046.down },
  '047_reference_change_log': { up: m047.up, down: m047.down },
  '048_managed_origin': { up: m048.up, down: m048.down },
  '049_terminology_managed_origin': { up: m049.up, down: m049.down },
  '050_terminology_generation': { up: m050.up, down: m050.down },
  '051_sync_sites': { up: m051.up, down: m051.down },
  '052_sync_site_keys': { up: m052.up, down: m052.down },
  '053_workflow_secrets': { up: m053.up, down: m053.down },
  '054_sync_amendments': { up: m054.up, down: m054.down },
  '055_sync_quarantine': { up: m055.up, down: m055.down },
  '056_sync_divergences': { up: m056.up, down: m056.down },
  '057_sync_site_cursors': { up: m057.up, down: m057.down },
  '058_drop_reported_pull_cursor': { up: m058.up, down: m058.down },
  '059_sync_activity': { up: m059.up, down: m059.down },
  '060_notifications': { up: m060.up, down: m060.down },
  '061_terminology_ingest_jobs': { up: m061.up, down: m061.down },
  '062_rbac': { up: m062.up, down: m062.down },
};
