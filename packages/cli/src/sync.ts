import { createAppContext, enrollSite, listSites, rotateSite, revokeSite } from '@openldr/bootstrap';
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

const SECRET_WARNING = '⚠ Store the client secret now — it will not be shown again.';

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
      `clientId     = ${result.clientId}`,
      `clientSecret = ${result.clientSecret}`,
      `siteId       = ${result.siteId}`,
      `centralUrl   = ${result.centralUrl}`,
      `oidcIssuer   = ${result.oidcIssuer}`,
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
      `clientId     = ${result.clientId}`,
      `clientSecret = ${result.clientSecret}`,
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
