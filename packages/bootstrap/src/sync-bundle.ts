import { writeFile } from 'node:fs/promises';
import {
  readCursor as readChangeCursor,
  advanceCursor as advanceChangeCursor,
  fetchSafeChangeRows,
  createReferenceApplier,
} from '@openldr/db';
import { signManifest, verifyArtifact } from '@openldr/marketplace';
import {
  packBundle,
  unpackBundle,
  collectPushRecords,
  createTerminologyBulkSync,
  type BundleManifest,
  type BundleRecords,
  type PullRecord,
  type PushDeps,
  type ConceptWire,
  type MapElementWire,
  BUNDLE_FORMAT_VERSION,
} from '@openldr/sync';
import { readSigningKeys } from './sync-settings';
import { ensureCentralKeypair, SiteNotFoundError } from './enrollment';
import { servePull, drainConcepts, drainMapElements } from './sync-serve';
import type { AppContext } from './index';

// Sync S5 — the offline store-and-forward orchestrations: the bundle equivalents of the S1 push +
// S2 reference-config pull HTTP paths. A push bundle is a signed, gzipped window of a lab's change_log
// (verified with the site's public key on central, then applyRemote'd exactly like /api/sync/push). A
// pull bundle is central's signed reference-config window (verified with central's pinned public key
// on the lab, then reference-applied exactly like /api/sync/pull). The pull bundle is symmetric: it
// carries NON-terminology reference config AND terminology (terminology_system / concept_map) — the
// exporter DRAINS + EMBEDS each system's concepts / map's elements into the record body, and the lab
// importer feeds that embedded set into the exact S3 whole-system reconcile (createTerminologyBulkSync)
// via its injectable fetch seam — no HTTP, no reconcile reimplementation.
//
// Security invariants (both directions): the signature is verified BEFORE any apply; push is cross-
// site-guarded + idempotent with NO gap guard (applyRemote is monotonic + order-independent); pull is
// contiguity-guarded (the reference applier can regress a table, so an out-of-order window is
// rejected). The site private key is never touched here — imports use only public keys (the site's
// stored verify key, or the lab's own pinned central public key).

/** A bundle failed ed25519 verification against the expected key (wrong signer, tamper, or a
 *  corrupted payload). Thrown BEFORE any record is applied. */
export class BundleSignatureError extends Error {
  constructor(m = 'bundle signature invalid') {
    super(m);
    this.name = 'BundleSignatureError';
  }
}

/** A pull bundle starts ahead of the lab's consumed cursor — applying it would skip reference changes
 *  and leave the lab's config out of sync. The lab must import the intervening bundle(s) first. */
export class BundleGapError extends Error {
  constructor(
    public fromCursor: number,
    public cursor: number,
  ) {
    super(`bundle starts at ${fromCursor} but cursor is ${cursor} (gap)`);
    this.name = 'BundleGapError';
  }
}

/** Sign a manifest+records into the final gzipped bundle bytes. packBundle is called TWICE with the
 *  same records so the payload string (and its sha256) is identical both times: once WITHOUT a
 *  signature to obtain the sha256 to sign over, then again with the embedded signature to write. The
 *  signature covers canonicalSigningBytes(manifest-without-signature, payloadSha256). */
function signBundleBytes(manifest: BundleManifest, records: BundleRecords, privHex: string): Buffer {
  const base: BundleManifest = { ...manifest };
  delete base.signature;
  const { payloadSha256 } = packBundle(base, records);
  const signature = signManifest(base as unknown as Record<string, unknown>, payloadSha256, Buffer.from(privHex, 'hex'));
  return packBundle({ ...base, signature }, records).bytes; // re-pack — payload identical, sha256 unchanged
}

/** Unpack + verify a bundle against `pubHex`. Throws {@link BundleSignatureError} on any verification
 *  failure BEFORE returning the records, so no caller can apply an unverified bundle. */
function verifyBundleBytes(bytes: Buffer, pubHex: string): { manifest: BundleManifest; records: BundleRecords } {
  const { manifest, records, payloadSha256 } = unpackBundle(bytes);
  if (!verifyArtifact(manifest as unknown as Record<string, unknown>, payloadSha256, Buffer.from(pubHex, 'hex'))) {
    throw new BundleSignatureError();
  }
  return { manifest, records };
}

/** Upsert body for a specific origin version, read from the append-only FHIR history — identical to
 *  the push worker's `fetchContent` wiring in bootstrap. */
function fetchContent(ctx: AppContext): PushDeps['fetchContent'] {
  return async (resourceType, id, version) => {
    const row = await ctx.internalDb
      .selectFrom('fhir.resource_history')
      .select('resource')
      .where('resource_type', '=', resourceType)
      .where('id', '=', id)
      .where('version', '=', version)
      .executeTakeFirst();
    return (row?.resource as never) ?? null;
  };
}

/**
 * Export a signed PUSH bundle (lab → central): the lab's own change_log window from `from` (default:
 * the 'sync-push' cursor) using the shared safe-frontier collector, so the bundle carries records
 * byte-identical to an HTTP push. Signed with the lab's own signing private key. Piggybacks the lab's
 * consumed 'sync-pull' position so central can track how current the lab's reference config is.
 * Advances the 'sync-push' cursor to `toCursor` ONLY when `from` was NOT explicitly given (a `--from`
 * re-export must be a read-only snapshot).
 */
export async function exportPushBundle(
  ctx: AppContext,
  opts: { from?: number; out?: string },
): Promise<{ path: string; manifest: BundleManifest }> {
  const { signingPrivateKey, siteId } = await readSigningKeys(ctx.appSettings, ctx.decryptSecret);
  if (!signingPrivateKey) throw new Error('sync export: lab signing private key not configured (enroll first)');
  if (!siteId) throw new Error('sync export: sync.site_id not configured');

  const cursor = await readChangeCursor(ctx.internalDb, 'sync-push');
  const from = opts.from ?? cursor;

  // DRAIN the FULL safe frontier into one bundle: collectPushRecords fetches a single batchSize page,
  // so a >1-page backlog would otherwise yield a partial bundle. Loop it — accumulate records, step
  // the cursor to each page's newCursor, and carry pendingGaps forward (so a rolled-back gap straddling
  // a page boundary confirms on a later page exactly as the live runner would) — until a cycle makes no
  // progress (no cursor advance) or the safety cap trips. `toCursor` is the furthest cursor the drain
  // reached, even if the final page produced 0 records (matches the runner advancing over a tail of
  // confirmed-rolled-back gaps), so a gap tail is stepped over once instead of re-scanned every export.
  const drainDeps = { internalDb: ctx.internalDb, fetchSafeRows: fetchSafeChangeRows, fetchContent: fetchContent(ctx), logger: ctx.logger };
  const MAX_PAGES = 10_000; // safety valve against a pathological non-terminating drain
  type Drain = Awaited<ReturnType<typeof collectPushRecords>>;
  const records: Drain['records'] = [];
  let drained = from;
  let pendingGaps: Drain['pendingGaps'] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await collectPushRecords(drainDeps, drained, pendingGaps);
    pendingGaps = res.pendingGaps;
    if (res.records.length > 0) records.push(...res.records);
    if (res.newCursor <= drained) break; // no progress (rows exhausted / blocked at an in-flight gap)
    drained = res.newCursor;
  }
  const toCursor = drained;
  const pullCursor = await readChangeCursor(ctx.internalDb, 'sync-pull');

  const manifest: BundleManifest = {
    formatVersion: BUNDLE_FORMAT_VERSION,
    kind: 'push',
    siteId,
    fromCursor: from,
    toCursor,
    recordCount: records.length,
    signerKeyId: siteId,
    producedAt: new Date().toISOString(),
    pullCursor,
  };
  const bytes = signBundleBytes(manifest, { kind: 'push', records }, signingPrivateKey);

  const path = opts.out ?? `sync-push-${siteId}-${from}-${toCursor}.bundle`;
  await writeFile(path, bytes);

  // Only a from-the-cursor export advances the cursor; an explicit --from is a non-destructive re-read.
  if (opts.from === undefined && toCursor > from) {
    await advanceChangeCursor(ctx.internalDb, 'sync-push', toCursor);
  }
  return { path, manifest };
}

/**
 * Import a PUSH bundle on central (lab → central): verify the signature with the enrolled site's
 * stored public key, then apply each record with the SAME per-record discipline as /api/sync/push —
 * cross-site guard (a record's siteId must equal the manifest siteId) + per-record isolation
 * (applyRemote in try/catch). Idempotent (applyRemote is monotonic). No gap guard (order-independent).
 * Records the piggybacked lab pull cursor. Throws {@link SiteNotFoundError} for an unknown/revoked/
 * keyless site and {@link BundleSignatureError} on a bad signature — both BEFORE any apply.
 */
export async function importPushBundle(
  ctx: AppContext,
  bytes: Buffer,
): Promise<{ applied: number; ackSeq: number; siteId: string }> {
  // Read the manifest first (unverified) to resolve the claimed site + its verify key.
  const { manifest } = unpackBundle(bytes);
  if (manifest.kind !== 'push') throw new Error(`sync import: expected a push bundle, got ${manifest.kind}`);
  const site = await ctx.syncSites.get(manifest.siteId);
  if (!site || site.status === 'revoked' || !site.signingPublicKey) throw new SiteNotFoundError(manifest.siteId);

  // Verify BEFORE any apply, with the site's public key.
  const { records } = verifyBundleBytes(bytes, site.signingPublicKey);
  if (records.kind !== 'push') throw new Error('sync import: push bundle payload kind mismatch');

  let applied = 0;
  let diverged = 0;
  let ackSeq = manifest.fromCursor;
  for (const rec of records.records) {
    if (typeof rec?.seq === 'number' && Number.isFinite(rec.seq)) ackSeq = Math.max(ackSeq, rec.seq);
    if (rec.siteId !== manifest.siteId) {
      // A bundle may only carry its own site's changes — never apply a cross-site record.
      ctx.logger.warn({ id: rec.id, seq: rec.seq, recSite: rec.siteId, siteId: manifest.siteId }, 'sync import: cross-site record rejected');
      continue;
    }
    try {
      const result = await ctx.fhirStore.applyRemote(rec);
      if (result === 'applied') applied++;
      else if (result === 'diverged') diverged++;
    } catch (e) {
      // Per-record isolation: one bad record must not abort the whole bundle.
      ctx.logger.warn({ error: e instanceof Error ? e.message : String(e), id: rec.id, seq: rec.seq }, 'sync import: applyRemote failed for record');
    }
  }

  // Same-version divergence (S7) — the record was handled and recorded in sync_divergences by
  // applyRemote itself; surfaced here so a bundle import is not silent about it.
  if (diverged > 0) {
    ctx.logger.warn({ diverged, siteId: manifest.siteId }, 'sync import: same-version divergence(s) detected — see sync_divergences');
  }

  // Piggybacked lab pull position (how current the lab's reference config is). Best-effort tracking.
  if (manifest.pullCursor != null) await ctx.syncSites.setReportedPullCursor(manifest.siteId, manifest.pullCursor);

  return { applied, ackSeq, siteId: manifest.siteId };
}

/**
 * Export a signed reference-config PULL bundle on central (central → lab): serve the reference-config
 * window from the site's reported pull cursor via the shared {@link servePull}, EMBED each terminology
 * signal's full content (a terminology_system upsert carries its drained `concepts`; a concept_map
 * upsert carries its drained `elements`) into the record body so an offline lab can apply them without
 * a follow-up HTTP drain, then sign with central's private key. Does NOT advance any central cursor
 * (central is stateless per pull; the lab tracks its own consumed position).
 */
export async function exportPullBundle(
  ctx: AppContext,
  opts: { siteId: string; out?: string },
): Promise<{ path: string; manifest: BundleManifest }> {
  const { privHex } = await ensureCentralKeypair(ctx);
  const from = await ctx.syncSites.getReportedPullCursor(opts.siteId); // 0 → full snapshot
  const resp = await servePull(ctx, from);
  const records = resp.records;
  // Embed terminology content in the record body so the lab reconciles it offline. Only an UPSERT
  // carries content — a `delete` record has no body (the lab's reconcile empties the system/map from an
  // absent embedded set, mirroring the HTTP worker draining an emptied system). The descriptor fields
  // servePull already put in the body (version/kind/generation/…) are preserved; the reconcile reads
  // those and ignores the extra concepts/elements array.
  for (const rec of records) {
    if (rec.op !== 'upsert') continue;
    if (rec.entityType === 'terminology_system') {
      rec.body = { ...((rec.body as object | null) ?? {}), concepts: await drainConcepts(ctx, rec.entityId) };
    } else if (rec.entityType === 'concept_map') {
      rec.body = { ...((rec.body as object | null) ?? {}), elements: await drainMapElements(ctx, rec.entityId) };
    }
  }

  const manifest: BundleManifest = {
    formatVersion: BUNDLE_FORMAT_VERSION,
    kind: 'pull',
    siteId: opts.siteId,
    fromCursor: from,
    toCursor: resp.nextSeq,
    recordCount: records.length,
    signerKeyId: 'central',
    producedAt: new Date().toISOString(),
  };
  const bytes = signBundleBytes(manifest, { kind: 'pull', records }, privHex);

  const path = opts.out ?? `sync-pull-${opts.siteId}-${from}-${resp.nextSeq}.bundle`;
  await writeFile(path, bytes);
  return { path, manifest };
}

/** Build a bundle-backed terminology bulk sync for ONE pull record: the S3 reconcile
 *  (createTerminologyBulkSync) driven by the concepts/elements EMBEDDED in the record body instead of
 *  central's HTTP bulk endpoints. The injected fetch seam returns the whole embedded set on the first
 *  (afterCursor===null) page and an empty page thereafter — a whole-system / whole-map single-page
 *  drain — so the reconcile runs its exact offline. A `delete` record has no embedded content, so the
 *  fetch returns an empty set and the reconcile empties that system/map (matching the HTTP worker
 *  draining an emptied system). No token needed (no HTTP). */
function bundleTerminologyBulk(ctx: AppContext, rec: PullRecord) {
  const body = rec.body as { concepts?: ConceptWire[]; elements?: MapElementWire[] } | null | undefined;
  return createTerminologyBulkSync({
    labDb: ctx.internalDb,
    getToken: async () => '',
    logger: ctx.logger,
    fetchConceptsPage: async (_systemUrl, afterCode) =>
      afterCode === null ? { concepts: body?.concepts ?? [], nextCode: null } : { concepts: [], nextCode: null },
    fetchMapElementsPage: async (_mapUrl, afterKey) =>
      afterKey === null ? { elements: body?.elements ?? [], nextKey: null } : { elements: [], nextKey: null },
  });
}

/**
 * Import a reference-config PULL bundle on the lab (central → lab): verify with the lab's pinned
 * central public key, enforce contiguity (a bundle starting AHEAD of the consumed 'sync-pull' cursor
 * is a {@link BundleGapError}), then apply each record. Non-terminology records go through the
 * reference applier; a terminology_system / concept_map record is reconciled offline through the exact
 * S3 whole-system bulk sync fed by the concepts/elements EMBEDDED in the bundle (see
 * {@link bundleTerminologyBulk}) — mirroring the pull worker's applyRecord in index.ts, but with no
 * HTTP. Advances 'sync-pull' to the bundle's toCursor. Idempotent: a re-import (fromCursor <= cursor)
 * re-applies harmlessly and never regresses the cursor.
 */
export async function importPullBundle(
  ctx: AppContext,
  bytes: Buffer,
): Promise<{ applied: number; toCursor: number }> {
  const { centralPublicKey } = await readSigningKeys(ctx.appSettings, ctx.decryptSecret);
  if (!centralPublicKey) throw new Error('sync import: central public key not pinned (enroll first)');

  // Verify BEFORE any apply, with the pinned central public key.
  const { manifest, records } = verifyBundleBytes(bytes, centralPublicKey);
  if (manifest.kind !== 'pull' || records.kind !== 'pull') throw new Error('sync import: expected a pull bundle');

  const cursor = await readChangeCursor(ctx.internalDb, 'sync-pull');
  // Contiguity guard: the reference applier can regress a table, so a window that skips ahead of what
  // the lab has consumed must be rejected (unlike push, which is order-independent).
  if (manifest.fromCursor > cursor) throw new BundleGapError(manifest.fromCursor, cursor);

  const applyReferenceChange = createReferenceApplier(ctx.internalDb);
  let applied = 0;
  for (const rec of records.records) {
    try {
      // Terminology reconciles offline via the embedded concepts/elements; everything else is a
      // per-row reference apply. Mirrors index.ts's applyRecord (terminology → bulk, else → applier).
      if (rec.entityType === 'terminology_system') {
        await bundleTerminologyBulk(ctx, rec).syncSystem(rec.entityId, rec.body);
        applied++;
      } else if (rec.entityType === 'concept_map') {
        await bundleTerminologyBulk(ctx, rec).syncConceptMap(rec.entityId, rec.body);
        applied++;
      } else {
        const result = await applyReferenceChange(rec as PullRecord);
        if (result === 'applied') applied++;
      }
    } catch (e) {
      ctx.logger.warn(
        { error: e instanceof Error ? e.message : String(e), entityType: rec.entityType, entityId: rec.entityId, seq: rec.seq },
        'sync import: reference apply failed for record',
      );
    }
  }

  // Advance only forward — a re-imported (older) bundle must never regress the cursor.
  if (manifest.toCursor > cursor) await advanceChangeCursor(ctx.internalDb, 'sync-pull', manifest.toCursor);
  return { applied, toCursor: manifest.toCursor };
}
