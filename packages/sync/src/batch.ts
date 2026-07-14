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
