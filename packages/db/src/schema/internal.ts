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

export interface InternalSchema {
  fhir_resources: FhirResourcesTable;
  outbox_events: OutboxEventsTable;
  ingest_batches: IngestBatchesTable;
  plugins: PluginsTable;
  audit_events: AuditEventsTable;
  users: UsersTable;
}
