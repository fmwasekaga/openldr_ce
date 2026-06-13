import { createDbContext, createAppContext } from '@openldr/bootstrap';
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
  const ctx = await createDbContext(loadConfig());
  try {
    const org = { resourceType: 'Organization', id: 'seed-org', name: 'Seed Central Lab' };
    const loc = {
      resourceType: 'Location',
      id: 'seed-loc',
      status: 'active',
      name: 'Seed Bench',
      managingOrganization: { reference: 'Organization/seed-org' },
    };
    const patient = {
      resourceType: 'Patient',
      id: 'seed-pat',
      gender: 'female',
      birthDate: '1990-01-01',
      managingOrganization: { reference: 'Organization/seed-org' },
    };
    const results: { id: string; flattened: string }[] = [];
    for (const r of [org, loc, patient]) {
      const out = await ctx.persist(r, { sourceSystem: 'seed' });
      results.push({ id: r.id, flattened: out.flattened });
    }
    emit(opts.json, { ok: true, results }, `seeded ${results.length} resources`);
    return 0;
  } finally {
    await ctx.close();
  }
}
