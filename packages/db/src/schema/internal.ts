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

export interface InternalSchema {
  fhir_resources: FhirResourcesTable;
  outbox_events: OutboxEventsTable;
  ingest_batches: IngestBatchesTable;
}
