import { readFile } from 'node:fs/promises';
import {
  createAppContext,
  enrollSite,
  listSites,
  rotateSite,
  revokeSite,
  exportPushBundle,
  importPushBundle,
  exportPullBundle,
  importPullBundle,
  mergePatients,
} from '@openldr/bootstrap';
import { unpackBundle } from '@openldr/sync';
import { loadConfig } from '@openldr/config';
import { redactError } from './redact-error';

// `openldr sync status|now` — surfaces the live SyncHandle (status + triggerNow) that the server
// exposes under /api/settings/sync/*. Distinct from `openldr settings sync …`, which edits the stored
// config. Both build a full AppContext so the handle sees the same workers/cursors the server would.
//
// `openldr sync enroll|list|rotate|revoke` — central-side lab enrollment (Sync S4d). These call the
// same enrollment orchestrator the HTTP settings endpoints use; the client secret is printed ONCE at
// enroll/rotate and is NEVER stored, so `sync list` can only ever show metadata.

interface JsonOpt { json: boolean }

function emit(json: boolean, payload: unknown, human: string): void {
  process.stdout.write(json ? JSON.stringify(payload, null, 2) + '\n' : human + '\n');
}

// Report a handled failure: JSON mode → a machine-readable {error} on stdout, text mode → stderr.
// Returns 1 so callers can `return fail(...)` and set the exit code in one line.
function fail(json: boolean, message: string): number {
  if (json) process.stdout.write(JSON.stringify({ error: message }, null, 2) + '\n');
  else process.stderr.write(message + '\n');
  return 1;
}

export async function runSyncStatus(opts: JsonOpt): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try {
    const s = await ctx.sync.status();
    emit(opts.json, s, [
      `enabled = ${s.enabled}`,
      `mode = ${s.mode}`,
      `central = ${s.centralUrl || '-'}`,
      `site = ${s.siteId || '-'}`,
      `push = ${s.push ? `${s.push.running ? 'running' : 'idle'} · seq ${s.push.lastSeq}${s.push.lastSyncedAt ? ` · ${s.push.lastSyncedAt}` : ''}` : 'not started'}`,
      `pull = ${s.pull ? `${s.pull.running ? 'running' : 'idle'} · seq ${s.pull.lastSeq}${s.pull.lastSyncedAt ? ` · ${s.pull.lastSyncedAt}` : ''}` : 'not started'}`,
      `pendingPush = ${s.pendingPush}`,
    ].join('\n'));
    return 0;
  } finally {
    await ctx.close();
  }
}

export async function runSyncNow(opts: JsonOpt): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try {
    const s = await ctx.sync.status();
    if (!s.enabled) {
      emit(opts.json, { triggered: false, reason: 'disabled' }, 'sync is disabled — nothing to trigger');
      return 1;
    }
    ctx.sync.triggerNow();
    emit(opts.json, { triggered: true }, 'sync triggered');
    return 0;
  } finally {
    await ctx.close();
  }
}

// `openldr sync quarantine list|retry` — inspect + retry poison-bulk quarantine (Sync S7-A). Runs on the lab.
export async function runSyncQuarantineList(opts: JsonOpt): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try {
    const rows = await ctx.sync.listQuarantine();
    if (opts.json) {
      emit(true, rows, '');
      return 0;
    }
    if (rows.length === 0) {
      process.stdout.write('no quarantined records\n');
      return 0;
    }
    for (const r of rows) {
      process.stdout.write(`${r.status.padEnd(11)} ${r.entityType}  ${r.entityId}  attempts=${r.attempts}  ${r.lastError ?? ''}\n`);
    }
    return 0;
  } finally {
    await ctx.close();
  }
}

export async function runSyncQuarantineRetry(entityType: string, entityId: string, opts: JsonOpt): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try {
    const result = await ctx.sync.retryQuarantine(entityType, entityId);
    emit(opts.json, result, result.ok ? `retried ${entityType} ${entityId}` : `retry failed: ${result.error ?? 'unknown'}`);
    return result.ok ? 0 : 1;
  } finally {
    await ctx.close();
  }
}

const SECRET_WARNING = '⚠ Store the client secret AND signing private key now — they will not be shown again.';

export async function runSyncEnroll(
  siteId: string,
  opts: { name?: string; centralUrl?: string; json?: boolean },
): Promise<number> {
  const json = opts.json ?? false;
  const centralUrl = opts.centralUrl;
  if (!centralUrl) return fail(json, 'central URL required (use --central-url)');

  const ctx = await createAppContext(loadConfig());
  try {
    const result = await enrollSite(ctx, { siteId, name: opts.name ?? null, centralUrl, actor: null });
    emit(json, result, [
      SECRET_WARNING,
      '',
      `clientId          = ${result.clientId}`,
      `clientSecret      = ${result.clientSecret}`,
      `siteId            = ${result.siteId}`,
      `centralUrl        = ${result.centralUrl}`,
      `oidcIssuer        = ${result.oidcIssuer}`,
      `signingPrivateKey = ${result.signingPrivateKey}`,
      `centralPublicKey  = ${result.centralPublicKey}`,
    ].join('\n'));
    return 0;
  } catch (err) {
    switch (err instanceof Error ? err.name : '') {
      case 'AlreadyEnrolledError':
        return fail(json, 'site already enrolled — use `openldr sync rotate <siteId>` to issue a new secret');
      case 'InvalidSiteIdError':
        return fail(json, 'invalid site id (must match [a-z0-9][a-z0-9-]{0,62})');
      case 'MissingCentralUrlError':
        return fail(json, 'central URL required (use --central-url)');
      case 'IdentityAdminNotConfiguredError':
        return fail(json, 'Keycloak admin not configured — enrollment runs on the central instance');
      default:
        return fail(json, `sync enroll failed: ${redactError(err)}`);
    }
  } finally {
    await ctx.close();
  }
}

// `openldr sync amend` — central-side result amendment (Sync S6a). Writes a new version of a lab-owned
// resource + a Provenance + the amendment outbox rows; the owning lab pulls it down. Runs on central.
export async function runSyncAmend(opts: {
  resourceType?: string;
  id?: string;
  status?: string;
  reason?: string;
  patch?: string;
  agent?: string;
  activity?: string;
  json?: boolean;
}): Promise<number> {
  const json = opts.json ?? false;
  if (!opts.resourceType || !opts.id || !opts.status) {
    return fail(json, '--resource-type, --id and --status are required');
  }
  let patch: Record<string, unknown> | undefined;
  if (opts.patch) {
    try {
      patch = JSON.parse(opts.patch) as Record<string, unknown>;
    } catch {
      return fail(json, '--patch must be valid JSON');
    }
  }
  const ctx = await createAppContext(loadConfig());
  try {
    const result = await ctx.fhirStore.amend({
      resourceType: opts.resourceType,
      id: opts.id,
      status: opts.status,
      reason: opts.reason,
      patch,
      agent: opts.agent ?? 'central',
      activity: opts.activity,
    });
    emit(json, result, [
      `resource    = ${opts.resourceType}/${opts.id}`,
      `version     = ${result.version}`,
      `provenance  = ${result.provenanceId}`,
      `owningSite  = ${result.siteId}`,
    ].join('\n'));
    return 0;
  } catch (err) {
    switch (err instanceof Error ? err.name : '') {
      case 'ResourceNotFoundError':
        return fail(json, 'resource not found');
      case 'NotLabOwnedError':
        return fail(json, 'resource is not lab-owned (central can only amend synced-up results)');
      case 'UnsupportedResourceTypeError':
        return fail(json, 'only Observation, DiagnosticReport, ServiceRequest can be amended');
      default:
        return fail(json, `sync amend failed: ${redactError(err)}`);
    }
  } finally {
    await ctx.close();
  }
}

// `openldr sync merge-patient` — intra-lab patient merge (Sync S6b). Runs on central.
export async function runSyncMergePatient(opts: {
  survivor?: string;
  duplicate?: string;
  reason?: string;
  agent?: string;
  json?: boolean;
}): Promise<number> {
  const json = opts.json ?? false;
  if (!opts.survivor || !opts.duplicate) return fail(json, '--survivor and --duplicate are required');
  const ctx = await createAppContext(loadConfig());
  try {
    const result = await mergePatients(ctx, {
      survivorId: opts.survivor,
      duplicateId: opts.duplicate,
      reason: opts.reason,
      agent: opts.agent ?? 'central',
    });
    emit(json, result, [
      `survivor   = ${result.survivorId}`,
      `duplicate  = ${result.duplicateId}`,
      `repointed  = ${result.repointed}`,
      `provenance = ${result.provenanceId}`,
      `owningSite = ${result.siteId}`,
    ].join('\n'));
    return 0;
  } catch (err) {
    switch (err instanceof Error ? err.name : '') {
      case 'SamePatientError':
        return fail(json, 'survivor and duplicate are the same patient');
      case 'PatientNotFoundError':
        return fail(json, 'patient not found');
      case 'CrossSiteMergeError':
        return fail(json, 'patients are not owned by the same site (intra-lab merge only)');
      default:
        return fail(json, `sync merge-patient failed: ${redactError(err)}`);
    }
  } finally {
    await ctx.close();
  }
}

export async function runSyncList(opts: JsonOpt): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try {
    const sites = await listSites(ctx);
    if (opts.json) {
      emit(true, sites, '');
      return 0;
    }
    if (sites.length === 0) {
      process.stdout.write('no sites enrolled\n');
      return 0;
    }
    const rows = sites.map((s) => [s.siteId, s.name ?? '-', s.clientId, s.status, s.enrolledAt]);
    const headers = ['SITE ID', 'NAME', 'CLIENT ID', 'STATUS', 'ENROLLED AT'];
    const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
    const line = (cells: string[]): string => cells.map((c, i) => c.padEnd(widths[i])).join('  ').trimEnd();
    process.stdout.write([line(headers), ...rows.map(line)].join('\n') + '\n');
    return 0;
  } finally {
    await ctx.close();
  }
}

export async function runSyncRotate(siteId: string, opts: JsonOpt): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try {
    const result = await rotateSite(ctx, siteId);
    emit(opts.json, result, [
      SECRET_WARNING,
      '',
      `clientId          = ${result.clientId}`,
      `clientSecret      = ${result.clientSecret}`,
      `signingPrivateKey = ${result.signingPrivateKey}`,
      `centralPublicKey  = ${result.centralPublicKey}`,
    ].join('\n'));
    return 0;
  } catch (err) {
    if (err instanceof Error && err.name === 'SiteNotFoundError') return fail(opts.json, 'site not found');
    if (err instanceof Error && err.name === 'IdentityAdminNotConfiguredError') {
      return fail(opts.json, 'Keycloak admin not configured — enrollment runs on the central instance');
    }
    return fail(opts.json, `sync rotate failed: ${redactError(err)}`);
  } finally {
    await ctx.close();
  }
}

// `openldr sync export|import` — offline bundle transfer for air-gapped sites (Sync S5). A lab exports
// its operational data as a signed PUSH bundle; central imports it. Reverse for reference/terminology
// config (a signed PULL bundle central exports per site). No secret is ever written or printed here —
// bundles carry no private key, and the signing key lives in config.

export async function runSyncExport(
  opts: { kind?: 'push' | 'pull'; site?: string; from?: string; out?: string; json?: boolean },
): Promise<number> {
  const json = opts.json ?? false;
  // A lab exports a push bundle; a central pull export targets one site — so an explicit --kind wins,
  // else infer from whether a --site was named.
  const kind: 'push' | 'pull' = opts.kind ?? (opts.site ? 'pull' : 'push');
  if (kind === 'pull' && !opts.site) return fail(json, '--site required for a pull export');

  const ctx = await createAppContext(loadConfig());
  try {
    const { path, manifest } =
      kind === 'pull'
        ? await exportPullBundle(ctx, { siteId: opts.site as string, out: opts.out })
        : await exportPushBundle(ctx, { from: opts.from ? Number(opts.from) : undefined, out: opts.out });
    emit(json, manifest, [
      `kind        = ${manifest.kind}`,
      `siteId      = ${manifest.siteId}`,
      `cursor      = ${manifest.fromCursor} → ${manifest.toCursor}`,
      `recordCount = ${manifest.recordCount}`,
      `path        = ${path}`,
    ].join('\n'));
    return 0;
  } catch (err) {
    return fail(json, `sync export failed: ${redactError(err)}`);
  } finally {
    await ctx.close();
  }
}

export async function runSyncImport(file: string, opts: JsonOpt): Promise<number> {
  const json = opts.json ?? false;
  const ctx = await createAppContext(loadConfig());
  try {
    const bytes = await readFile(file);
    // Read the (unverified) manifest kind to dispatch; each importer verifies before applying.
    const kind = unpackBundle(bytes).manifest.kind;
    if (kind === 'pull') {
      const { applied, toCursor } = await importPullBundle(ctx, bytes);
      emit(json, { applied, toCursor }, `imported pull bundle — applied ${applied}, cursor → ${toCursor}`);
    } else {
      const { applied, ackSeq, siteId } = await importPushBundle(ctx, bytes);
      emit(json, { applied, ackSeq, siteId }, `imported push bundle from ${siteId} — applied ${applied}, ack seq ${ackSeq}`);
    }
    return 0;
  } catch (err) {
    switch (err instanceof Error ? err.name : '') {
      case 'BundleSignatureError':
        return fail(json, 'bundle signature invalid — wrong key or tampered');
      case 'BundleGapError':
        return fail(json, 'bundle is out of order (missing an earlier bundle) — import the earlier bundle first');
      case 'BundleFormatError':
        return fail(json, 'not a valid bundle file');
      case 'SiteNotFoundError':
        return fail(json, 'unknown or revoked site');
      default:
        return fail(json, `sync import failed: ${redactError(err)}`);
    }
  } finally {
    await ctx.close();
  }
}

export async function runSyncRevoke(siteId: string, opts: JsonOpt): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try {
    await revokeSite(ctx, siteId);
    emit(opts.json, { revoked: true, siteId }, `revoked ${siteId}`);
    return 0;
  } catch (err) {
    if (err instanceof Error && err.name === 'IdentityAdminNotConfiguredError') {
      return fail(opts.json, 'Keycloak admin not configured — enrollment runs on the central instance');
    }
    return fail(opts.json, `sync revoke failed: ${redactError(err)}`);
  } finally {
    await ctx.close();
  }
}
