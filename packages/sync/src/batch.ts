import type { FhirResource } from '@openldr/fhir';

// One change replayed from a lab's fhir.change_log, in wire form. Mirrors db.RemoteRecord
// (version + siteId taken verbatim from the origin) plus the change_log sequence number.
export interface SyncRecord {
  resourceType: string;
  id: string;
  version: number;
  op: 'upsert' | 'delete';
  siteId: string;
  resource?: FhirResource; // present for op:'upsert'
}

// A directional push from a lab: an ordered, contiguous window of change_log records.
// `fromSeq` is the cursor the lab pushed from (the central ack anchor).
export interface PushBatch {
  fromSeq: number;
  records: (SyncRecord & { seq: number })[];
}

// Central's response to a push: how far it durably applied, and any per-record rejects.
export interface PushResponse {
  ackSeq: number;
  applied: number;
  skipped: number;
  rejects: { id: string; version: number; seq: number; reason: string }[];
}

// One reference change served by central to a lab, in wire form. Mirrors the reference_change_log's
// entity coordinates + op; `body` carries the config content for an upsert (absent for a delete).
export interface PullRecord {
  seq: number;
  entityType:
    | 'form'
    | 'dashboard'
    | 'report'
    | 'setting'
    | 'publisher'
    | 'coding_system'
    | 'term_mapping'
    | 'terminology_system'
    | 'concept_map';
  entityId: string;
  op: 'upsert' | 'delete';
  contentHash?: string | null;
  body?: unknown; // present for op:'upsert'
}

// A lab's pull request: give me reference changes after `fromSeq` (the lab's 'sync-pull' cursor).
export interface PullRequest {
  fromSeq: number;
}

// Central's response to a pull: an ordered window of reference changes and the next cursor to resume
// from (the max seq in the served window; advancing to it starts the next pull after it).
export interface PullResponse {
  records: PullRecord[];
  nextSeq: number;
}

// Sync S3: bulk terminology transfer wire shapes. Mirror the keyset-paginated bulk endpoints
// (POST /api/sync/terminology/concepts and .../map-elements) — one page of a whole-system /
// whole-map drain plus the resume key (null on the last, short page).
export interface ConceptWire {
  code: string;
  display: string | null;
  status: string | null;
  properties: Record<string, unknown> | null;
}
export interface ConceptsPage {
  concepts: ConceptWire[];
  nextCode: string | null;
}
export interface MapElementWire {
  sourceSystem: string;
  sourceCode: string;
  targetSystem: string;
  targetCode: string;
  equivalence: string | null;
}
export interface MapElementsPage {
  elements: MapElementWire[];
  nextKey: { sourceSystem: string; sourceCode: string } | null;
}
