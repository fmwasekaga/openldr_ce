import { describe, it, expect, vi } from 'vitest';
import { FEATURE_FLAGS } from '@openldr/config';
import { seedDatabase, type FormSeedTarget } from './seed';
import type { DbContext } from './db-context';

// In-memory fakes so we exercise the real seedDatabase logic without a database.
function fakeApp(cfg: FormSeedTarget['cfg'] = {}) {
  const forms: { id: string; name: string; status: string }[] = [];
  const workflows: { id: string; name: string; definition?: unknown }[] = [];
  const connectors: { id: string; name: string; type: string | null; config: Record<string, string> }[] = [];
  const dashboards: { id: string }[] = [];
  // Terminology stores modelled just enough to exercise real idempotency: value sets deduped by
  // url (as importFhirCatalog does), UCUM concepts deduped by (system, code) (as the loader does).
  const valueSets: { url: string; publisherId: string | null }[] = [];
  const concepts = new Set<string>(); // `${system}\t${code}`
  const terminology: FormSeedTarget['terminology'] = {
    ops: {
      lookup: async (system: string, code: string) => ({ found: concepts.has(`${system}\t${code}`) }),
    },
    admin: {
      valueSets: {
        list: async (publisherId?: string) =>
          valueSets.filter((v) => !publisherId || v.publisherId === publisherId) as never,
        importFhirCatalog: async (resource: unknown) => {
          const cat = resource as { valueSets?: { url: string }[] };
          let imported = 0;
          let skipped = 0;
          for (const vs of cat.valueSets ?? []) {
            if (valueSets.some((x) => x.url === vs.url)) { skipped += 1; continue; }
            valueSets.push({ url: vs.url, publisherId: 'pub-hl7-fhir' });
            imported += 1;
          }
          return { imported, skipped, valueSet: null } as never;
        },
      },
    },
    loaders: {
      resource: async (json: unknown) => {
        const cs = json as { url?: string; concept?: { code: string }[] };
        let conceptsLoaded = 0;
        for (const c of cs.concept ?? []) {
          const key = `${cs.url}\t${c.code}`;
          if (!concepts.has(key)) { concepts.add(key); conceptsLoaded += 1; }
        }
        return { conceptsLoaded };
      },
    },
  };
  const settings = new Map<string, string>();
  const reportTemplates: { id: string }[] = [];
  const reportDesigns: { id: string }[] = [];
  const reportDefs: { id: string; designId?: string }[] = [];
  const app: FormSeedTarget = {
    appSettings: {
      get: async (key: string) => {
        const value = settings.get(key);
        return value !== undefined ? { key, value, updatedAt: new Date(), updatedBy: 'system' } : null;
      },
      set: async (key: string, value: string) => { settings.set(key, value); },
    },
    forms: {
      list: async () => forms as never,
      create: async (f: { name: string; status?: string }) => {
        const created = { id: `form-${forms.length}`, name: f.name, status: f.status ?? 'draft' };
        forms.push(created);
        return created as never;
      },
      setStatus: async (id: string, status: string) => {
        const f = forms.find((x) => x.id === id);
        if (f) f.status = status;
        return f as never;
      },
    },
    workflows: {
      store: {
        list: async () => workflows as never,
        create: async (w: { id: string; name: string; definition?: unknown }) => {
          workflows.push({ id: w.id, name: w.name, definition: w.definition });
          return w as never;
        },
      },
    },
    connectors: {
      list: async () => connectors as never,
      create: async (input: { id: string; name: string; type?: string | null; config: Record<string, string> }) => {
        connectors.push({ id: input.id, name: input.name, type: input.type ?? null, config: input.config });
      },
    },
    dashboards: {
      store: {
        get: async (id: string) => dashboards.find((d) => d.id === id) as never,
        create: async (d: { id: string }) => {
          if (!dashboards.some((x) => x.id === d.id)) dashboards.push({ id: d.id });
          return d as never;
        },
      },
    },
    reportTemplates: {
      get: async (id: string) => reportTemplates.find((r) => r.id === id) as never,
      create: async (t: { id: string }) => {
        if (!reportTemplates.some((x) => x.id === t.id)) reportTemplates.push({ id: t.id });
        return t as never;
      },
    },
    reportDesigns: {
      get: async (id: string) => reportDesigns.find((r) => r.id === id) as never,
      create: async (d: { id: string }) => {
        if (!reportDesigns.some((x) => x.id === d.id)) reportDesigns.push({ id: d.id });
        return d as never;
      },
      remove: async (id: string) => {
        const idx = reportDesigns.findIndex((x) => x.id === id);
        if (idx !== -1) reportDesigns.splice(idx, 1);
      },
    },
    reportDefs: {
      get: async (id: string) => reportDefs.find((r) => r.id === id) as never,
      create: async (r: { id: string; designId?: string }) => {
        if (!reportDefs.some((x) => x.id === r.id)) reportDefs.push({ id: r.id, designId: r.designId });
        return r as never;
      },
      list: async () => reportDefs as never,
    },
    terminology,
    cfg,
  };
  return { app, workflows, connectors, dashboards, reportTemplates, reportDesigns, reportDefs, valueSets, concepts, settings };
}

const fakeDb = { persist: vi.fn(async (r: { id: string }) => ({ flattened: JSON.stringify(r) })) } as unknown as DbContext;

describe('seedDatabase — default workflows', () => {
  // The seeded sample-forms include "Lab order" at index 3 → the fake assigns it id 'form-3'.
  const ORDER_FORM_ID = 'form-3';

  it('seeds the inbound + reactive default workflows', async () => {
    const { app, workflows } = fakeApp();
    const res = await seedDatabase(fakeDb, app);
    expect(res.workflowsSeeded).toBe(2);
    expect(workflows.map((w) => w.id).sort()).toEqual(['wf-sample', 'wf-sample-reactive']);
  });

  it('injects the seeded "Lab order" form id into the inbound Form Validate node', async () => {
    const { app, workflows } = fakeApp();
    await seedDatabase(fakeDb, app);
    const inbound = workflows.find((w) => w.id === 'wf-sample');
    const def = inbound?.definition as { nodes: { data: { action?: string; config?: { formId?: string } } }[] };
    const fv = def.nodes.find((n) => n.data.action === 'form-validate');
    expect(fv?.data.config?.formId).toBe(ORDER_FORM_ID);
  });

  it('is idempotent — re-running seeds nothing new', async () => {
    const { app, workflows } = fakeApp();
    await seedDatabase(fakeDb, app);
    const res2 = await seedDatabase(fakeDb, app);
    expect(res2.workflowsSeeded).toBe(0);
    expect(workflows).toHaveLength(2);
  });
});

describe('seedDatabase — default connector', () => {
  const cfg = { SECRETS_ENCRYPTION_KEY: 'k', TARGET_DATABASE_URL: 'postgres://openldr:pw@warehouse:5433/openldr_target' };

  it('creates a postgres/database connector parsed from TARGET_DATABASE_URL', async () => {
    const { app, connectors } = fakeApp(cfg);
    const res = await seedDatabase(fakeDb, app);
    expect(res.connectorsSeeded).toBe(1);
    expect(connectors).toHaveLength(1);
    const c = connectors[0];
    expect(c.name).toBe('Target Warehouse (Postgres)');
    expect(c.type).toBe('postgres');
    expect(c.config).toEqual({ host: 'warehouse', port: '5433', user: 'openldr', password: 'pw', database: 'openldr_target', ssl: 'false' });
  });

  it('is idempotent by name — re-running does not duplicate it', async () => {
    const { app, connectors } = fakeApp(cfg);
    await seedDatabase(fakeDb, app);
    const res2 = await seedDatabase(fakeDb, app);
    expect(res2.connectorsSeeded).toBe(0);
    expect(connectors).toHaveLength(1);
  });

  it('skips (and does not throw) when SECRETS_ENCRYPTION_KEY is unset', async () => {
    const { app, connectors } = fakeApp({ TARGET_DATABASE_URL: cfg.TARGET_DATABASE_URL });
    const res = await seedDatabase(fakeDb, app);
    expect(res.connectorsSeeded).toBe(0);
    expect(connectors).toHaveLength(0);
  });

  it('skips when TARGET_DATABASE_URL is unset', async () => {
    const { app, connectors } = fakeApp({ SECRETS_ENCRYPTION_KEY: 'k' });
    const res = await seedDatabase(fakeDb, app);
    expect(res.connectorsSeeded).toBe(0);
    expect(connectors).toHaveLength(0);
  });
});

describe('seedDatabase — sample dashboard', () => {
  it('seeds the vetted sample dashboard (id "default") once', async () => {
    const { app, dashboards } = fakeApp();
    const res = await seedDatabase(fakeDb, app);
    expect(res.dashboardsSeeded).toBe(1);
    expect(dashboards.map((d) => d.id)).toEqual(['default']);
  });

  it('is idempotent — re-running does not duplicate it', async () => {
    const { app, dashboards } = fakeApp();
    await seedDatabase(fakeDb, app);
    const res2 = await seedDatabase(fakeDb, app);
    expect(res2.dashboardsSeeded).toBe(0);
    expect(dashboards).toHaveLength(1);
  });
});

describe('seedDatabase — feature-flag defaults', () => {
  it('seeds every registry flag once and is idempotent on reseed', async () => {
    const { app } = fakeApp();
    // First run against an empty appSettings fake writes one row per registry flag.
    const first = await seedDatabase(fakeDb, app);
    expect(first.settingsSeeded).toBe(FEATURE_FLAGS.length);
    // Reusing the SAME fake app (persisted settings Map) — the second run finds every
    // flag already present and re-writes nothing, so an operator's later toggle survives.
    const second = await seedDatabase(fakeDb, app);
    expect(second.settingsSeeded).toBe(0);
  });
});

describe('seedDatabase — bundled terminology', () => {
  it('imports the bundled FHIR R4 catalog and full UCUM code system on first boot', async () => {
    const { app, valueSets, concepts } = fakeApp();
    const res = await seedDatabase(fakeDb, app);
    // Hundreds of FHIR R4 value sets + hundreds of UCUM concepts from the real bundled fixtures.
    expect(res.terminology.valueSetsImported).toBeGreaterThan(100);
    expect(res.terminology.ucumConceptsImported).toBeGreaterThan(100);
    expect(valueSets.length).toBe(res.terminology.valueSetsImported);
    // meter is our UCUM presence marker — must be imported.
    expect(concepts.has('http://unitsofmeasure.org\tm')).toBe(true);
  });

  it('is idempotent — re-running imports nothing and does not throw', async () => {
    const { app, valueSets, concepts } = fakeApp();
    const first = await seedDatabase(fakeDb, app);
    const vsCount = valueSets.length;
    const conceptCount = concepts.size;
    const second = await seedDatabase(fakeDb, app);
    expect(second.terminology.valueSetsImported).toBe(0);
    expect(second.terminology.ucumConceptsImported).toBe(0);
    // No duplicates: totals unchanged after the second run.
    expect(valueSets.length).toBe(vsCount);
    expect(concepts.size).toBe(conceptCount);
    expect(first.terminology.valueSetsImported).toBeGreaterThan(0);
  });

  it('degrades gracefully when a fixture is missing (import throws → warning, seed continues)', async () => {
    const { app } = fakeApp();
    // Simulate a missing/broken fixture by making both importers throw.
    app.terminology.admin.valueSets.importFhirCatalog = async () => { throw new Error('fixture missing'); };
    app.terminology.loaders.resource = async () => { throw new Error('fixture missing'); };
    app.terminology.ops.lookup = async () => ({ found: false });
    app.terminology.admin.valueSets.list = async () => [] as never;
    const res = await seedDatabase(fakeDb, app);
    // The rest of the seed still succeeds; terminology counts fall back to 0.
    expect(res.terminology).toEqual({ valueSetsImported: 0, ucumConceptsImported: 0 });
    expect(res.workflowsSeeded).toBe(2);
    expect(res.dashboardsSeeded).toBe(1);
  });
});

describe('seedDatabase — report templates', () => {
  it('seeds both report templates on a fresh install, idempotent on reseed', async () => {
    const { app, reportTemplates } = fakeApp();
    const first = await seedDatabase(fakeDb, app);
    expect(first.reportTemplatesSeeded).toBe(5);
    expect(reportTemplates.map((r) => r.id).sort()).toEqual(['rt-amr-facility-summary', 'rt-amr-resistance', 'rt-analyte-interpretation', 'rt-patient-demographics', 'rt-sample-amr']);
    const second = await seedDatabase(fakeDb, app);
    expect(second.reportTemplatesSeeded).toBe(0);
  });
});

describe('seedDatabase — report designs', () => {
  it('seeds no default report designs (SEED_DESIGNS is empty as of Slice S5)', async () => {
    const { app, reportDesigns } = fakeApp();
    const first = await seedDatabase(fakeDb, app);
    expect(first.reportDesignsSeeded).toBe(0);
    expect(reportDesigns).toHaveLength(0);
    const second = await seedDatabase(fakeDb, app);
    expect(second.reportDesignsSeeded).toBe(0);
  });
});

describe('seedDatabase — retired demo design cleanup (Slice S5)', () => {
  it('removes leftover demo designs from a pre-S5 install when unreferenced', async () => {
    const { app, reportDesigns } = fakeApp();
    for (const id of ['rt-amr-summary', 'rt-monthly-caseload', 'rt-lab-tat']) reportDesigns.push({ id });

    const res = await seedDatabase(fakeDb, app);
    expect(res.demoDesignsRemoved).toBe(3);
    expect(reportDesigns).toHaveLength(0);
  });

  it('skips a demo design still referenced by a reports record', async () => {
    const { app, reportDesigns, reportDefs } = fakeApp();
    for (const id of ['rt-amr-summary', 'rt-monthly-caseload', 'rt-lab-tat']) reportDesigns.push({ id });
    reportDefs.push({ id: 'r-custom', designId: 'rt-amr-summary' });

    const res = await seedDatabase(fakeDb, app);
    expect(res.demoDesignsRemoved).toBe(2);
    expect(reportDesigns.map((r) => r.id)).toEqual(['rt-amr-summary']);
  });

  it('is a no-op on a fresh install and idempotent on reseed', async () => {
    const { app } = fakeApp();
    const first = await seedDatabase(fakeDb, app);
    expect(first.demoDesignsRemoved).toBe(0);
    const second = await seedDatabase(fakeDb, app);
    expect(second.demoDesignsRemoved).toBe(0);
  });
});

describe('seedDatabase — data-driven reports (S4)', () => {
  it('skips (best-effort, no throw) when no default connector is configured', async () => {
    // fakeApp() with no cfg → seedDefaultConnector skips (SECRETS_ENCRYPTION_KEY/TARGET_DATABASE_URL
    // unset) → seedDataDrivenReports finds no connector named DEFAULT_CONNECTOR_NAME and skips too,
    // even though SEED_QUERIES/SEED_DESIGNS/SEED_REPORT_DEFS are populated as of Task 4.2.
    const { app, reportDefs } = fakeApp();
    const res = await seedDatabase(fakeDb, app);
    expect(res.dataDrivenReportsSeeded).toEqual({ queriesSeeded: 0, designsSeeded: 0, reportDefsSeeded: 0 });
    expect(reportDefs).toHaveLength(0);
  });

  it('degrades gracefully when the connector IS seeded (real SEED_QUERIES content exercised, no crash)', async () => {
    // With a connector configured, seedDataDrivenReports proceeds past the connector-resolution
    // guard and touches SEED_QUERIES/SEED_DESIGNS/SEED_REPORT_DEFS — this fake harness has no real
    // Kysely `db.internalDb` (see `fakeDb` above), so `createCustomQueryStore(db.internalDb)`'s
    // store throws once queried; the surrounding try/catch in seed.ts (best-effort, matching every
    // other seed step) swallows it and the rest of the seed still completes.
    const cfg = { SECRETS_ENCRYPTION_KEY: 'k', TARGET_DATABASE_URL: 'postgres://openldr:pw@warehouse:5433/openldr_target' };
    const { app } = fakeApp(cfg);
    const res = await seedDatabase(fakeDb, app);
    expect(res.connectorsSeeded).toBe(1);
    expect(res.dataDrivenReportsSeeded).toEqual({ queriesSeeded: 0, designsSeeded: 0, reportDefsSeeded: 0 });
    expect(res.formsSeeded).toBeGreaterThan(0);
  });
});

describe('fhirValueSetCatalogToInputs — bundled R4 fixture parses', () => {
  it('parses the bundled R4 catalog into value sets', async () => {
    const { BUNDLED_TERMINOLOGY, readBundledTerminology, fhirValueSetCatalogToInputs } = await import('@openldr/db');
    const catalog = await readBundledTerminology(BUNDLED_TERMINOLOGY.fhirR4Catalog);
    expect(catalog).not.toBeNull();
    const parsed = fhirValueSetCatalogToInputs(catalog);
    expect(parsed.version).toBe('R4');
    expect(parsed.valueSets.length).toBeGreaterThan(100);
    expect(parsed.valueSets.every((v) => typeof v.url === 'string' && v.url.length > 0)).toBe(true);
  });
});
