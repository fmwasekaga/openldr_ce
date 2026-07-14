import { gzipSync, gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { canonicalJson } from '@openldr/core';
import type { SyncRecord, PullRecord } from './batch';

// On-disk format for offline sync bundles. PURE structure + gzip + sha256 — NO crypto keys, NO signing.
// The bootstrap layer signs the manifest (ed25519) and verifies over the payloadSha256 this module
// returns. Bumping this rejects incompatible files on unpack.
export const BUNDLE_FORMAT_VERSION = 1;

export type BundleKind = 'push' | 'pull';

// The bundle header. Everything the receiver needs to route + verify a bundle without decoding the
// payload. `signature` is filled in by the bootstrap signer (this module never touches it).
export interface BundleManifest {
  formatVersion: number;
  kind: BundleKind;
  siteId: string;
  fromCursor: number;
  toCursor: number;
  recordCount: number;
  signerKeyId: string; // siteId for push, 'central' for pull — selects the verify key
  producedAt: string; // ISO string, stamped by the caller (runtime, Date is fine)
  pullCursor?: number; // push bundles only (piggybacked lab 'sync-pull' position)
  signature?: string; // hex ed25519 sig, set by the bootstrap signer
}

// The bundle body, discriminated on `kind` so push/pull records never mix. Mirrors the S1/S2 wire
// shapes exactly (push = change_log records with seq; pull = reference_change_log records).
export type BundleRecords =
  | { kind: 'push'; records: (SyncRecord & { seq: number })[] }
  | { kind: 'pull'; records: PullRecord[] };

export class BundleFormatError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'BundleFormatError';
  }
}

// Deterministic serialization of the records array + its sha256. canonicalJson sorts object keys
// (arrays keep order), so the same records always produce the same string and hash regardless of key
// insertion order — the signer covers this hash.
function payloadOf(records: unknown): { payload: string; sha256: string } {
  const payload = canonicalJson(records);
  const sha256 = createHash('sha256').update(payload).digest('hex');
  return { payload, sha256 };
}

/** Serialize a bundle to gzipped bytes and return the payloadSha256 the caller signs over.
 * The stored file is gzip(JSON.stringify({ manifest, payload })), where payload is the deterministic
 * records string that sha256 covers. The bootstrap signer calls this once WITHOUT a signature to get
 * the sha256, signs (manifest-without-signature + sha256), embeds the signature into the manifest, and
 * calls this AGAIN to write the signed bytes — the payload string is identical both times, so the
 * sha256 unpackBundle recomputes matches what was signed. */
export function packBundle(
  manifest: BundleManifest,
  records: BundleRecords,
): { bytes: Buffer; payloadSha256: string } {
  if (records.kind !== manifest.kind) throw new BundleFormatError('records.kind != manifest.kind');
  const { payload, sha256 } = payloadOf(records.records);
  const file = JSON.stringify({ manifest, payload });
  return { bytes: gzipSync(Buffer.from(file, 'utf8')), payloadSha256: sha256 };
}

/** Parse gzipped bytes → manifest + records + the recomputed payloadSha256 (for the caller to verify
 * against the signature). Throws BundleFormatError on malformed input. Does NOT verify the signature. */
export function unpackBundle(bytes: Buffer): {
  manifest: BundleManifest;
  records: BundleRecords;
  payloadSha256: string;
} {
  let file: { manifest?: BundleManifest; payload?: string };
  try {
    file = JSON.parse(gunzipSync(bytes).toString('utf8'));
  } catch (e) {
    throw new BundleFormatError(`unreadable bundle: ${(e as Error).message}`);
  }
  const manifest = file.manifest;
  if (!manifest || manifest.formatVersion !== BUNDLE_FORMAT_VERSION)
    throw new BundleFormatError('bad or missing manifest/formatVersion');
  if (typeof file.payload !== 'string') throw new BundleFormatError('missing payload');
  // Recompute the sha256 over the STORED payload string (not a re-serialization) so pack/unpack agree
  // by construction — any byte-level tamper of the stored payload changes this hash.
  const sha256 = createHash('sha256').update(file.payload).digest('hex');
  let parsed: unknown;
  try {
    parsed = JSON.parse(file.payload);
  } catch (e) {
    throw new BundleFormatError(`bad payload json: ${(e as Error).message}`);
  }
  if (!Array.isArray(parsed)) throw new BundleFormatError('payload is not an array');
  const records: BundleRecords =
    manifest.kind === 'push'
      ? { kind: 'push', records: parsed as (SyncRecord & { seq: number })[] }
      : { kind: 'pull', records: parsed as PullRecord[] };
  return { manifest, records, payloadSha256: sha256 };
}
