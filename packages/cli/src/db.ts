import { createDbContext, createAppContext, seedDatabase } from '@openldr/bootstrap';
import { loadConfig } from '@openldr/config';
import { redactError } from './redact-error';

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
    // Surface the underlying message rather than a bare 'migration error'. Kysely's own text
    // (e.g. "corrupted migrations: previously executed migration 055_x is missing") names both
    // the problem and its fix; swallowing it left `db migrate` — the command the docs point at
    // when a schema is behind — impossible to diagnose. Redacted: a driver error can echo the DSN.
    const internalError = res.internal.error ? redactError(res.internal.error) : undefined;
    const externalError = res.external.error ? redactError(res.external.error) : undefined;
    if (internalError || externalError) {
      const detail = [
        internalError ? `  internal: ${internalError}` : null,
        externalError ? `  external: ${externalError}` : null,
      ]
        .filter(Boolean)
        .join('\n');
      emit(
        opts.json,
        { ok: false, error: 'migration_failed', internalError, externalError, internalNames, externalNames },
        `migration error\n${detail}`,
      );
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

/** Human-readable refusal naming what is outstanding and the (non-destructive) remedy. */
function pendingMigrationsMessage(pending: { internal: string[]; external: string[] }): string {
  const count = pending.internal.length + pending.external.length;
  const lines = [`db seed refused: the database schema is behind the code (${count} pending migration(s)).`];
  if (pending.internal.length) lines.push(`  internal: ${pending.internal.join(', ')}`);
  if (pending.external.length) lines.push(`  external: ${pending.external.join(', ')}`);
  lines.push('', 'Run `openldr db migrate` first, then re-run `openldr db seed`.');
  return lines.join('\n');
}

export async function runDbSeed(opts: JsonOpt): Promise<number> {
  const cfg = loadConfig();
  const ctx = await createDbContext(cfg);
  try {
    // Refuse BEFORE building the app context: creating it boots the SEC-06 workflow-secret
    // shim, which on a stale schema logs a `relation ... does not exist` stack trace and
    // then continues. Checking first means the operator sees the cause, not the symptom.
    const pending = await ctx.pendingMigrations();
    if (pending.internal.length || pending.external.length) {
      emit(opts.json, { ok: false, error: 'pending_migrations', pending }, pendingMigrationsMessage(pending));
      return 1;
    }

    const appCtx = await createAppContext(cfg);
    try {
      const { resources, formsSeeded, workflowsSeeded, connectorsSeeded, dashboardsSeeded, settingsSeeded, terminology } = await seedDatabase(ctx, appCtx);
      emit(
        opts.json,
        { ok: true, results: resources, formsSeeded, workflowsSeeded, connectorsSeeded, dashboardsSeeded, settingsSeeded, terminology },
        `seeded ${resources.length} resources, ${formsSeeded} forms, ${workflowsSeeded} workflow(s), ${connectorsSeeded} connector(s), ${dashboardsSeeded} dashboard(s), ${settingsSeeded} setting(s), ${terminology.valueSetsImported} value set(s), ${terminology.ucumConceptsImported} UCUM concept(s)`,
      );
      return 0;
    } finally {
      await appCtx.close();
    }
  } finally {
    await ctx.close();
  }
}
