import { createDbContext, createAppContext, seedDatabase } from '@openldr/bootstrap';
import { loadConfig } from '@openldr/config';

interface JsonOpt {
  json: boolean;
}

function emit(json: boolean, payload: unknown, human: string): void {
  process.stdout.write(json ? JSON.stringify(payload, null, 2) + '\n' : human + '\n');
}

export async function runDbMigrate(opts: JsonOpt): Promise<number> {
  const ctx = await createDbContext(loadConfig());
  try {
    const res = await ctx.migrateAll();
    const internalNames = (res.internal.results ?? []).map((r) => r.migrationName);
    const externalNames = (res.external.results ?? []).map((r) => r.migrationName);
    if (res.internal.error || res.external.error) {
      emit(opts.json, { ok: false, internalNames, externalNames }, 'migration error');
      return 1;
    }
    emit(
      opts.json,
      { ok: true, internal: internalNames, external: externalNames },
      `migrated internal: [${internalNames.join(', ')}]  external: [${externalNames.join(', ')}]`,
    );
    return 0;
  } finally {
    await ctx.close();
  }
}

export async function runDbReset(opts: JsonOpt & { force: boolean }): Promise<number> {
  const ctx = await createDbContext(loadConfig());
  try {
    await ctx.reset({ force: opts.force });
    try {
      const appCtx = await createAppContext(loadConfig());
      try {
        await appCtx.audit.record({ actorType: 'system', actorName: 'system', action: 'db.reset', entityType: 'database', entityId: 'internal+external' });
      } finally {
        await appCtx.close();
      }
    } catch {
      // audit is best-effort
    }
    emit(opts.json, { ok: true }, 'database reset complete');
    return 0;
  } finally {
    await ctx.close();
  }
}

export async function runDbSeed(opts: JsonOpt): Promise<number> {
  const cfg = loadConfig();
  const ctx = await createDbContext(cfg);
  const appCtx = await createAppContext(cfg);
  try {
    const { resources, formsSeeded, workflowsSeeded, connectorsSeeded, dashboardsSeeded } = await seedDatabase(ctx, appCtx);
    emit(
      opts.json,
      { ok: true, results: resources, formsSeeded, workflowsSeeded, connectorsSeeded, dashboardsSeeded },
      `seeded ${resources.length} resources, ${formsSeeded} forms, ${workflowsSeeded} workflow(s), ${connectorsSeeded} connector(s), ${dashboardsSeeded} dashboard(s)`,
    );
    return 0;
  } finally {
    await appCtx.close();
    await ctx.close();
  }
}
