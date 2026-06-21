import { createDbContext, createAppContext } from '@openldr/bootstrap';
import { loadConfig } from '@openldr/config';
import { sampleForms } from '@openldr/forms';

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

    // Seed sample forms idempotently (skip if already present by id)
    const appCtx = await createAppContext(loadConfig());
    let formsSeeded = 0;
    try {
      // Dedup by name, not id: forms.create() always generates a fresh `form-<uuid>` id and
      // ignores the sample's id, so id-based dedup would re-create the samples every run.
      const existingForms = await appCtx.forms.list();
      const existingByName = new Map(existingForms.map((f) => [f.name, f]));
      for (const form of sampleForms) {
        const existing = existingByName.get(form.name);
        // Capture just id + status — list() yields FormSummary, create() yields FormDefinition.
        let id: string;
        let status: string;
        if (existing) {
          id = existing.id;
          status = existing.status;
        } else {
          const created = await appCtx.forms.create({
            name: form.name,
            versionLabel: form.versionLabel,
            fhirResourceType: form.fhirResourceType,
            fhirVersion: form.fhirVersion,
            fhirProfileUrl: form.fhirProfileUrl,
            facilityId: form.facilityId,
            status: form.status,
            active: form.active,
            schema: form,
            targetPages: form.targetPages,
          });
          id = created.id;
          status = created.status;
          formsSeeded++;
        }
        // Publish so the forms actually drive their target pages (the Users page needs a
        // published 'users' form). Idempotent: only publish drafts, never re-snapshot.
        if (status !== 'published') await appCtx.forms.setStatus(id, 'published');
      }
    } finally {
      await appCtx.close();
    }

    emit(
      opts.json,
      { ok: true, results, formsSeeded },
      `seeded ${results.length} resources, ${formsSeeded} forms`,
    );
    return 0;
  } finally {
    await ctx.close();
  }
}
