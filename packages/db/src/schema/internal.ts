import type { Generated, JSONColumnType } from 'kysely';
import type { FhirResource } from '@openldr/fhir';

export interface FhirResourcesTable {
  resource_type: string;
  id: string;
  version: Generated<number>; // monotonic integer version (distinct from version_id, the FHIR meta.versionId string mirror)
  version_id: string | null;
  resource: JSONColumnType<FhirResource>;
  source_system: string | null;
  plugin_id: string | null;
  plugin_version: string | null;
  batch_id: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface ResourceHistoryTable {
  resource_type: string;
  id: string;
  version: number;
  op: string; // 'upsert' | 'delete'
  resource: JSONColumnType<FhirResource> | null; // null for delete tombstones
  recorded_at: Generated<Date>;
}

export interface ChangeLogTable {
  seq: Generated<number>;
  resource_type: string;
  resource_id: string;
  version: number;
  op: string; // 'upsert' | 'delete'
  content_hash: string | null;
  site_id: string | null;
  recorded_at: Generated<Date>;
}

export interface ChangeCursorsTable {
  consumer: string;
  last_seq: Generated<number>;
  updated_at: Generated<Date>;
}

// Distributed sync S2: append-only reference-data change-capture log (public schema).
// Mirrors ChangeLogTable's cursor shape for config entities (form/dashboard/report/setting).
export interface ReferenceChangeLogTable {
  seq: Generated<number>;
  entity_type: string;
  entity_id: string;
  op: string; // 'upsert' | 'delete'
  content_hash: string | null;
  recorded_at: Generated<Date>;
}

export interface OutboxEventsTable {
  id: string;
  type: string;
  payload: JSONColumnType<Record<string, unknown>>;
  status: Generated<string>;
  attempts: Generated<number>;
  max_attempts: Generated<number>;
  last_error: string | null;
  batch_id: string | null;
  available_at: Generated<Date>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface IngestBatchesTable {
  batch_id: string;
  source: string | null;
  blob_key: string;
  content_type: string | null;
  converter: string;
  status: Generated<string>;
  resource_count: Generated<number>;
  attempts: Generated<number>;
  last_error: string | null;
  config: JSONColumnType<Record<string, string>> | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface PluginsTable {
  id: string;
  version: string;
  sha256: string;
  manifest: JSONColumnType<Record<string, unknown>>;
  status: Generated<string>;
  installed_at: Generated<Date>;
  enabled: Generated<boolean>;
  active: Generated<boolean>;
  approved_by: string | null;
  granted_at: Date | null;
}

export interface AuditEventsTable {
  id: string;
  occurred_at: Generated<Date>;
  actor_type: string;
  actor_id: string | null;
  actor_name: string;
  action: string;
  entity_type: string;
  entity_id: string;
  before: JSONColumnType<Record<string, unknown>> | null;
  after: JSONColumnType<Record<string, unknown>> | null;
  metadata: JSONColumnType<Record<string, unknown>> | null;
}

export interface UsersTable {
  id: string;
  subject: string | null;
  username: string;
  display_name: string | null;
  email: string | null;
  roles: JSONColumnType<string[]>;
  status: Generated<string>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  last_login_at: Date | null;
}

export interface DashboardsTable {
  id: string;
  owner_id: string | null;
  name: string;
  layout: JSONColumnType<unknown[]>;
  widgets: JSONColumnType<unknown[]>;
  filters: JSONColumnType<unknown[]>;
  refresh_interval_sec: Generated<number>;
  is_default: Generated<boolean>;
  managed_origin: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface TerminologyConceptsTable {
  system: string;
  code: string;
  display: string | null;
  status: string | null;
  properties: JSONColumnType<Record<string, unknown>> | null;
}

export interface TerminologySystemsTable {
  url: string;
  version: string | null;
  kind: string;
  resource_id: string;
  // Sync S3: bump-once-per-import bulk change signal. `bigint DEFAULT 0` reads back as a string on
  // real PG (number under pg-mem); Generated<> keeps it optional on insert so saveSystem (which does
  // not set it) still typechecks. The mark* helpers set it explicitly and Number()-coerce on read.
  generation: Generated<number | string>;
  managed_origin: string | null;
}

export interface ConceptMapElementsTable {
  map_url: string;
  source_system: string;
  source_code: string;
  target_system: string;
  target_code: string;
  equivalence: string | null;
}

// Sync S3: per-concept-map generation registry (concept_map_elements has no PK/metadata row of its
// own, so the bulk change signal for maps lives here, keyed by map_url). Mirrors the terminology_systems
// generation/managed_origin columns.
export interface ConceptMapStateTable {
  map_url: string;
  generation: Generated<number | string>;
  managed_origin: string | null;
}

export interface PublishersTable {
  id: string;
  name: string;
  role: string; // 'local' | 'standard' | 'external'
  icon: string | null;
  match_prefixes: JSONColumnType<string[]>;
  seeded: Generated<boolean>;
  sort_order: Generated<number>;
  managed_origin: string | null;
}

export interface CodingSystemsTable {
  id: string;
  system_code: string;
  system_name: string;
  url: string | null;
  system_version: string | null;
  description: string | null;
  active: Generated<boolean>;
  publisher_id: string | null;
  seeded: Generated<boolean>;
  managed_origin: string | null;
}

export interface TermMappingsTable {
  id: string;
  from_system: string;
  from_code: string;
  to_system: string;
  to_code: string;
  to_display: string | null;
  map_type: string;
  relationship: string | null;
  owner: string | null;
  is_active: Generated<boolean>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  managed_origin: string | null;
}

export interface ValueSetsTable {
  id: string;
  url: string;
  version: string | null;
  name: string | null;
  title: string | null;
  status: Generated<string>;
  experimental: Generated<boolean>;
  description: string | null;
  compose: JSONColumnType<Record<string, unknown>>;
  source_json: JSONColumnType<Record<string, unknown>> | null;
  immutable: Generated<boolean>;
  category: string | null;
  publisher_id: string | null;
  expanded_at: Date | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface ValuesetExpansionsTable {
  value_set_id: string;
  system_url: string;
  code: string;
  display: string | null;
  inactive: Generated<boolean>;
}

export interface OntologyDistributionsTable {
  coding_system_id: string;
  ontology_type: string;
  source_path: string;
  index_status: string;
  index_error: string | null;
  node_count: number | null;
  edge_count: number | null;
  manifest: unknown | null;
  built_at: string | null;
  updated_at: string;
}

export interface OntologyNodesTable {
  coding_system_id: string;
  code: string;
  display: string;
  kind: string | null;
  extra: unknown | null;
}

export interface OntologyEdgesTable {
  coding_system_id: string;
  parent_code: string;
  child_code: string;
  seq: number;
  label: string | null;
}

export interface OntologyPanelMembersTable {
  coding_system_id: string;
  panel_loinc: string;
  member_loinc: string;
  member_name: string;
  display_name: string;
  sequence: number;
  required: boolean;
}

export interface OntologyAnswerOptionsTable {
  coding_system_id: string;
  loinc: string;
  seq: number;
  value: string;
  label: string;
}

export interface OntologySpecimenMapTable {
  coding_system_id: string;
  loinc: string;
  snomed_code: string;
  equivalence: string;
}

export interface Dhis2OrgUnitMapTable {
  facility_id: string;
  orgunit_id: string;
  orgunit_name: string | null;
}

export interface Dhis2MappingsTable {
  id: string;
  name: string;
  definition: JSONColumnType<Record<string, unknown>>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface Dhis2SchedulesTable {
  id: string;
  mapping_id: string;
  mode: string;
  period_type: string;
  event_driven: Generated<boolean>;
  enabled: Generated<boolean>;
  last_run_at: Date | null;
  next_due_at: Date | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface Dhis2MetadataCacheTable {
  id: string;
  metadata: JSONColumnType<import('@openldr/ports').TargetMetadata>;
  pulled_at: Generated<Date>;
}

export interface FormDefinitionsTable {
  id: string;
  name: string;
  version_label: string | null;
  fhir_resource_type: string | null;
  fhir_version: string | null;
  fhir_profile_url: string | null;
  facility_id: string | null;
  status: string;
  active: boolean;
  schema: unknown;
  target_pages: unknown | null;
  managed_origin: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserProfilesTable {
  user_id: string;
  form_schema_id: string | null;
  form_version: number | null;
  extras: unknown;
  updated_at: Date;
}

export interface ReportRunsTable {
  id: string;
  report_id: string;
  report_name: string;
  format: string;
  params: JSONColumnType<Record<string, unknown>>;
  row_count: number | null;
  user_id: string | null;
  user_name: string | null;
  created_at: Generated<Date>;
}

export interface ReportSchedulesTable {
  id: string;
  report_id: string;
  params: JSONColumnType<Record<string, unknown>>;
  frequency: string;
  day_of_week: number | null;
  day_of_month: number | null;
  output_format: string;
  enabled: Generated<boolean>;
  last_run_at: Date | null;
  next_due_at: Date | null;
  created_by: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface ReportScheduleRunsTable {
  id: string;
  schedule_id: string;
  report_id: string;
  report_name: string;
  run_at: Generated<Date>;
  period_start: Date | null;
  period_end: Date | null;
  output_format: string;
  object_key: string | null;
  byte_size: number | null;
  row_count: number | null;
  status: string;
  error_message: string | null;
  created_at: Generated<Date>;
}

export interface FormVersionsTable {
  id: string;
  form_id: string;
  version: number;
  version_label: string | null;
  name: string;
  fhir_resource_type: string | null;
  fhir_version: string | null;
  fhir_profile_url: string | null;
  facility_id: string | null;
  schema: JSONColumnType<Record<string, unknown>>;
  target_pages: JSONColumnType<string[]> | null;
  questionnaire: JSONColumnType<Record<string, unknown>>;
  published_at: Generated<Date>;
  published_by: string | null;
}

export interface MarketplacePublishersTable {
  publisher_id: string;
  key_fingerprint: string;
  publisher_name: Generated<string>;
  pinned_at: Generated<Date>;
  approved_by: string | null;
}

export interface MarketplaceInstallsTable {
  artifact_id: string;
  version: string;
  kind: string;
  target_form_id: string;
  payload_sha256: string;
  publisher_name: string | null;
  source_ref: string | null;
  installed_by: string | null;
  installed_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface WorkflowsTable {
  id: string;
  name: string;
  description: string | null;
  definition: JSONColumnType<{ nodes: unknown[]; edges: unknown[] }>;
  enabled: Generated<boolean>;
  created_by: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface WorkflowRunsTable {
  id: string;
  workflow_id: string;
  trigger_source: string;
  status: string;
  started_at: Date;
  finished_at: Date;
  result: JSONColumnType<Record<string, unknown>>;
  error: string | null;
  correlation_id: string | null;
}

export interface WorkflowSchedulesTable {
  workflow_id: string;
  node_id: string;
  cron: string;
  tz: string | null;
  enabled: Generated<boolean>;
  next_due_at: Date | null;
}

export interface WorkflowDatasetsTable {
  id: string;
  name: string;
  columns: JSONColumnType<{ key: string; label: string }[]>;
  rows: JSONColumnType<Record<string, unknown>[]>;
  row_count: Generated<number>;
  workflow_id: string | null;
  published_table: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface CustomQueriesTable {
  id: string;
  name: string;
  connector_id: string;
  sql: string;
  params: unknown; // JSON: CustomQueryParam[]
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface ConnectorsTable {
  id: string;
  name: string;
  plugin_id: string | null;
  type: string | null;
  kind: string;
  config_encrypted: string;
  allowed_host: string | null;
  enabled: Generated<boolean>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface RegistriesTable {
  id: string;
  name: string;
  kind: string; // 'local' | 'http'
  location: string;
  enabled: Generated<boolean>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface PluginDataTable {
  plugin_id: string;
  collection: string;
  key: string;
  doc: JSONColumnType<Record<string, unknown>>;
  updated_at: Generated<Date>;
}

export interface AppSettingsTable {
  key: string;
  value: string;
  updated_at: Generated<Date>;
  updated_by: string | null;
}

export interface ReportDesignsTable {
  id: string;
  name: string;
  paper: Generated<string>;
  orientation: Generated<string>;
  pages: unknown;
  parameters: unknown;
  margins: unknown | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface ReportsTable {
  id: string;
  name: string;
  description: string;
  category: string;
  design_id: string;
  primary_query_id: string;
  summary_metrics: unknown | null;
  chart: unknown | null;
  param_options: unknown | null;
  status: string;
  managed_origin: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface InternalSchema {
  'fhir.fhir_resources': FhirResourcesTable;
  'fhir.resource_history': ResourceHistoryTable;
  'fhir.change_log': ChangeLogTable;
  'fhir.change_cursors': ChangeCursorsTable;
  reference_change_log: ReferenceChangeLogTable;
  outbox_events: OutboxEventsTable;
  ingest_batches: IngestBatchesTable;
  plugins: PluginsTable;
  audit_events: AuditEventsTable;
  users: UsersTable;
  terminology_concepts: TerminologyConceptsTable;
  terminology_systems: TerminologySystemsTable;
  concept_map_elements: ConceptMapElementsTable;
  concept_map_state: ConceptMapStateTable;
  publishers: PublishersTable;
  coding_systems: CodingSystemsTable;
  term_mappings: TermMappingsTable;
  value_sets: ValueSetsTable;
  valueset_expansions: ValuesetExpansionsTable;
  ontology_distributions: OntologyDistributionsTable;
  ontology_nodes: OntologyNodesTable;
  ontology_edges: OntologyEdgesTable;
  ontology_panel_members: OntologyPanelMembersTable;
  ontology_answer_options: OntologyAnswerOptionsTable;
  ontology_specimen_map: OntologySpecimenMapTable;
  dhis2_orgunit_map: Dhis2OrgUnitMapTable;
  dhis2_mappings: Dhis2MappingsTable;
  dhis2_schedules: Dhis2SchedulesTable;
  dhis2_metadata_cache: Dhis2MetadataCacheTable;
  dashboards: DashboardsTable;
  form_definitions: FormDefinitionsTable;
  form_versions: FormVersionsTable;
  user_profiles: UserProfilesTable;
  marketplace_publishers: MarketplacePublishersTable;
  marketplace_installs: MarketplaceInstallsTable;
  report_runs: ReportRunsTable;
  report_schedules: ReportSchedulesTable;
  report_schedule_runs: ReportScheduleRunsTable;
  workflows: WorkflowsTable;
  workflow_runs: WorkflowRunsTable;
  workflow_schedules: WorkflowSchedulesTable;
  workflow_datasets: WorkflowDatasetsTable;
  custom_queries: CustomQueriesTable;
  connectors: ConnectorsTable;
  registries: RegistriesTable;
  plugin_data: PluginDataTable;
  app_settings: AppSettingsTable;
  report_designs: ReportDesignsTable;
  reports: ReportsTable;
}
