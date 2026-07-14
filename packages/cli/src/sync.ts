import { createAppContext } from '@openldr/bootstrap';
import { loadConfig } from '@openldr/config';

// `openldr sync status|now` — surfaces the live SyncHandle (status + triggerNow) that the server
// exposes under /api/settings/sync/*. Distinct from `openldr settings sync …`, which edits the stored
// config. Both build a full AppContext so the handle sees the same workers/cursors the server would.

interface JsonOpt { json: boolean }

function emit(json: boolean, payload: unknown, human: string): void {
  process.stdout.write(json ? JSON.stringify(payload, null, 2) + '\n' : human + '\n');
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
