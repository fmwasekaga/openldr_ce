import { createAppContext, dangerResetDashboards, dangerFactoryReset, dangerClearAudit } from '@openldr/bootstrap';
import { loadConfig } from '@openldr/config';

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
