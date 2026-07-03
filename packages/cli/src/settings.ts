import { createAppContext, dangerResetDashboards, dangerFactoryReset, dangerClearAudit, getSyncConfig, setSyncConfig } from '@openldr/bootstrap';
import { loadConfig, type SyncConfig } from '@openldr/config';

interface JsonOpt { json: boolean }

function emit(json: boolean, payload: unknown, human: string): void {
  process.stdout.write(json ? JSON.stringify(payload, null, 2) + '\n' : human + '\n');
}

export async function runSettingsFlagsList(opts: JsonOpt): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try {
    const flags = await ctx.featureFlags.all();
    emit(opts.json, flags, flags.map((f) => `${f.value ? 'on ' : 'off'}  ${f.id}`).join('\n') || '(no flags)');
    return 0;
  } finally {
    await ctx.close();
  }
}

export async function runSettingsFlagsSet(key: string, value: string, opts: JsonOpt): Promise<number> {
  if (value !== 'true' && value !== 'false') {
    process.stderr.write(`value must be "true" or "false" (got "${value}")\n`);
    return 1;
  }
  const ctx = await createAppContext(loadConfig());
  try {
    const before = await ctx.featureFlags.get(key);
    await ctx.featureFlags.set(key, value === 'true', 'cli');
    await ctx.audit.record({ actorType: 'system', actorName: 'cli', action: 'settings.flag.update', entityType: 'app_setting', entityId: key, metadata: { key, before, after: value === 'true' } });
    emit(opts.json, { ok: true, key, value: value === 'true' }, `set ${key} = ${value}`);
    return 0;
  } finally {
    await ctx.close();
  }
}

export async function runSettingsNumbersList(opts: JsonOpt): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try {
    const nums = await ctx.numberSettings.all();
    emit(opts.json, nums, nums.map((n) => `${n.id} = ${n.value}  [${n.min}..${n.max}]`).join('\n') || '(none)');
    return 0;
  } finally {
    await ctx.close();
  }
}

export async function runSettingsNumbersSet(key: string, value: string, opts: JsonOpt): Promise<number> {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    process.stderr.write(`value must be a number (got "${value}")\n`);
    return 1;
  }
  const ctx = await createAppContext(loadConfig());
  try {
    let after: number;
    try {
      after = await ctx.numberSettings.set(key, n, 'cli');
    } catch (e) {
      process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
      return 1;
    }
    await ctx.audit.record({ actorType: 'system', actorName: 'cli', action: 'settings.number.update', entityType: 'app_setting', entityId: key, metadata: { key, after } });
    emit(opts.json, { ok: true, key, value: after }, `set ${key} = ${after}`);
    return 0;
  } finally {
    await ctx.close();
  }
}

const SYNC_FIELDS = ['enabled', 'mode', 'centralUrl', 'siteId', 'intervalMinutes'] as const;
type SyncField = (typeof SYNC_FIELDS)[number];

function coerceSyncField(field: SyncField, value: string): SyncConfig[SyncField] {
  if (field === 'enabled') return value === 'true' || value === '1';
  if (field === 'intervalMinutes') return Number(value);
  return value;
}

export async function runSettingsSyncShow(opts: JsonOpt): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try {
    const cfg = await getSyncConfig(ctx.appSettings);
    emit(
      opts.json,
      cfg,
      SYNC_FIELDS.map((f) => `${f} = ${String(cfg[f])}`).join('\n'),
    );
    return 0;
  } finally {
    await ctx.close();
  }
}

export async function runSettingsSyncSet(field: string, value: string, opts: JsonOpt): Promise<number> {
  if (!SYNC_FIELDS.includes(field as SyncField)) {
    process.stderr.write(`unknown field "${field}" (expected: ${SYNC_FIELDS.join(' | ')})\n`);
    return 1;
  }
  const ctx = await createAppContext(loadConfig());
  try {
    const current = await getSyncConfig(ctx.appSettings);
    const next = { ...current, [field]: coerceSyncField(field as SyncField, value) };
    let saved: SyncConfig;
    try {
      saved = await setSyncConfig(ctx.appSettings, next, 'cli');
    } catch (e) {
      process.stderr.write(`invalid value: ${e instanceof Error ? e.message : String(e)}\n`);
      return 1;
    }
    await ctx.audit.record({ actorType: 'system', actorName: 'cli', action: 'settings.sync.update', entityType: 'app_setting', entityId: 'sync.config', metadata: { field, before: current, after: saved } });
    emit(opts.json, saved, `set ${field} = ${String(saved[field as SyncField])}`);
    return 0;
  } finally {
    await ctx.close();
  }
}

const DANGER: Record<string, { run: (ctx: Awaited<ReturnType<typeof createAppContext>>) => Promise<void>; label: string }> = {
  'reset-dashboards': { run: dangerResetDashboards, label: 'dashboards reset to the sample' },
  'clear-audit': { run: dangerClearAudit, label: 'audit log + run history cleared' },
  'factory-reset': { run: dangerFactoryReset, label: 'internal database wiped and reseeded' },
};

export async function runSettingsDanger(action: string, opts: JsonOpt & { force: boolean }): Promise<number> {
  const entry = DANGER[action];
  if (!entry) {
    process.stderr.write(`unknown action "${action}" (expected: ${Object.keys(DANGER).join(' | ')})\n`);
    return 1;
  }
  if (!opts.force) {
    process.stderr.write(`refusing to run "${action}" without --force (destructive, internal DB only)\n`);
    return 1;
  }
  const ctx = await createAppContext(loadConfig());
  try {
    await entry.run(ctx);
    await ctx.audit.record({ actorType: 'system', actorName: 'cli', action: `settings.danger.${action}`, entityType: 'app_settings', entityId: 'internal-db', metadata: { action } });
    emit(opts.json, { ok: true, action }, entry.label);
    return 0;
  } finally {
    await ctx.close();
  }
}
