import type { Generated, JSONColumnType } from 'kysely';
import type { FhirResource } from '@openldr/fhir';

export interface FhirResourcesTable {
  resource_type: string;
  id: string;
  version_id: string | null;
  resource: JSONColumnType<FhirResource>;
  source_system: string | null;
  plugin_id: string | null;
  plugin_version: string | null;
  batch_id: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
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
}

export interface ConceptMapElementsTable {
  map_url: string;
  source_system: string;
  source_code: string;
  target_system: string;
  target_code: string;
  equivalence: string | null;
}

export interface PublishersTable {
  id: string;
  name: string;
  role: string; // 'local' | 'standard' | 'external'
  icon: string | null;
  match_prefixes: JSONColumnType<string[]>;
  seeded: Generated<boolean>;
  sort_order: Generated<number>;
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

export interface InternalSchema {
  fhir_resources: FhirResourcesTable;
  outbox_events: OutboxEventsTable;
  ingest_batches: IngestBatchesTable;
  plugins: PluginsTable;
  audit_events: AuditEventsTable;
  users: UsersTable;
  terminology_concepts: TerminologyConceptsTable;
  terminology_systems: TerminologySystemsTable;
  concept_map_elements: ConceptMapElementsTable;
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
  dashboards: DashboardsTable;
}
