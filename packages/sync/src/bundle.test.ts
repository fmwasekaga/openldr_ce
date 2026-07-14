import { gzipSync, gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  BUNDLE_FORMAT_VERSION,
  BundleFormatError,
  packBundle,
  unpackBundle,
  type BundleManifest,
  type BundleRecords,
} from './bundle';
import type { PullRecord, SyncRecord } from './batch';

// Realistic push records: two change_log rows (an upsert carrying a resource + a delete without one).
const pushRecords: (SyncRecord & { seq: number })[] = [
  {
    seq: 41,
    resourceType: 'Patient',
    id: 'pat-1',
    version: 3,
    op: 'upsert',
    siteId: 'lab-a',
    resource: { resourceType: 'Patient', id: 'pat-1', gender: 'female' } as SyncRecord['resource'],
  },
  {
    seq: 42,
    resourceType: 'Observation',
    id: 'obs-9',
    version: 1,
    op: 'delete',
    siteId: 'lab-a',
  },
];

const pushManifest: BundleManifest = {
  formatVersion: BUNDLE_FORMAT_VERSION,
  kind: 'push',
  siteId: 'lab-a',
  fromCursor: 40,
  toCursor: 42,
  recordCount: 2,
  signerKeyId: 'lab-a',
  producedAt: '2026-07-14T00:00:00.000Z',
  pullCursor: 17,
};

// Realistic pull records: a reference upsert (config body + hash) + a delete.
const pullRecords: PullRecord[] = [
  {
    seq: 100,
    entityType: 'form',
    entityId: 'form-cbc',
    op: 'upsert',
    contentHash: 'abc123',
    body: { title: 'CBC', fields: [{ name: 'wbc' }] },
  },
  {
    seq: 101,
    entityType: 'report',
    entityId: 'rep-amr',
    op: 'delete',
    contentHash: null,
  },
];

const pullManifest: BundleManifest = {
  formatVersion: BUNDLE_FORMAT_VERSION,
  kind: 'pull',
  siteId: 'lab-a',
  fromCursor: 99,
  toCursor: 101,
  recordCount: 2,
  signerKeyId: 'central',
  producedAt: '2026-07-14T00:00:00.000Z',
};

describe('packBundle / unpackBundle round-trip', () => {
  it('round-trips a PUSH bundle (records + manifest + payloadSha256 equal)', () => {
    const records: BundleRecords = { kind: 'push', records: pushRecords };
    const packed = packBundle(pushManifest, records);
    const out = unpackBundle(packed.bytes);
    expect(out.manifest).toEqual(pushManifest);
    expect(out.records.kind).toBe('push');
    expect(out.records.records).toEqual(pushRecords);
    expect(out.payloadSha256).toBe(packed.payloadSha256);
  });

  it('round-trips a PULL bundle (records + manifest + payloadSha256 equal)', () => {
    const records: BundleRecords = { kind: 'pull', records: pullRecords };
    const packed = packBundle(pullManifest, records);
    const out = unpackBundle(packed.bytes);
    expect(out.manifest).toEqual(pullManifest);
    expect(out.records.kind).toBe('pull');
    expect(out.records.records).toEqual(pullRecords);
    expect(out.payloadSha256).toBe(packed.payloadSha256);
  });
});

describe('unpackBundle rejects malformed input', () => {
  it('throws on non-gzip bytes', () => {
    expect(() => unpackBundle(Buffer.from('not gzip at all', 'utf8'))).toThrow(BundleFormatError);
  });

  it('throws on gzip-of-non-JSON', () => {
    const bytes = gzipSync(Buffer.from('this is not json', 'utf8'));
    expect(() => unpackBundle(bytes)).toThrow(BundleFormatError);
  });

  it('throws on a valid gzip+JSON with a missing payload', () => {
    const bytes = gzipSync(Buffer.from(JSON.stringify({ manifest: pushManifest }), 'utf8'));
    expect(() => unpackBundle(bytes)).toThrow(BundleFormatError);
  });

  it('throws on a wrong formatVersion', () => {
    const bad = { ...pushManifest, formatVersion: BUNDLE_FORMAT_VERSION + 1 };
    const bytes = gzipSync(Buffer.from(JSON.stringify({ manifest: bad, payload: '[]' }), 'utf8'));
    expect(() => unpackBundle(bytes)).toThrow(BundleFormatError);
  });

  it('throws when the payload is not a JSON array', () => {
    const bytes = gzipSync(
      Buffer.from(JSON.stringify({ manifest: pushManifest, payload: '{"not":"array"}' }), 'utf8'),
    );
    expect(() => unpackBundle(bytes)).toThrow(BundleFormatError);
  });
});

describe('tamper detection', () => {
  it('recomputed payloadSha256 differs after a record field is mutated', () => {
    const packed = packBundle(pushManifest, { kind: 'push', records: pushRecords });
    // gunzip → parse → mutate one record's field → re-gzip (simulates an in-flight tamper).
    const file = JSON.parse(gunzipSync(packed.bytes).toString('utf8')) as {
      manifest: BundleManifest;
      payload: string;
    };
    const payloadArr = JSON.parse(file.payload) as (SyncRecord & { seq: number })[];
    payloadArr[0].version = 999;
    const tampered = gzipSync(
      Buffer.from(JSON.stringify({ manifest: file.manifest, payload: JSON.stringify(payloadArr) })),
    );
    const out = unpackBundle(tampered);
    expect(out.payloadSha256).not.toBe(packed.payloadSha256);
  });
});

describe('packBundle guards kind mismatch', () => {
  it('throws when records.kind != manifest.kind', () => {
    expect(() =>
      packBundle(pushManifest, { kind: 'pull', records: pullRecords }),
    ).toThrow(BundleFormatError);
  });
});
