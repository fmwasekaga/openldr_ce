import { randomUUID } from 'node:crypto';
import { sampleForms, type FormStore } from '@openldr/forms';
import { buildDefaultWorkflows, type WorkflowStore } from '@openldr/workflows';
import { seedDefaultDashboard, type DashboardStore } from '@openldr/dashboards';
import { seedReportDesigns, removeRetiredDemoDesigns, type ReportDesignStore } from '@openldr/report-designer';
import { seedDataDrivenReports, DEFAULT_REPORT_CATEGORIES, type SeedDataDrivenReportsResult } from '@openldr/reporting';
import type { ConnectorStore, TerminologyAdminStore, AppSettingStore, ReportStore } from '@openldr/db';
import { BUNDLED_TERMINOLOGY, readBundledTerminology, createCustomQueryStore } from '@openldr/db';
import { FEATURE_FLAGS } from '@openldr/config';
import type { DbContext } from './db-context';
import { REPORT_CATEGORIES_SETTING_KEY } from './report-categories';

export interface SeedResult {
  resources: { id: string; flattened: string }[];
  formsSeeded: number;
  workflowsSeeded: number;
  connectorsSeeded: number;
  dashboardsSeeded: number;
  reportDesignsSeeded: number;
  /** Slice S5: one-shot cleanup count of retired demo designs (`rt-amr-summary` etc.) removed
   *  from an existing pre-cutover install — see `removeRetiredDemoDesigns`. Always 0 on a fresh
   *  install (nothing to remove) and on every re-run after the first cleanup (idempotent). */
  demoDesignsRemoved: number;
  /** S4: seeded data-driven query/design/report-record triples (`@openldr/reporting`'s
   *  SEED_QUERIES/SEED_DESIGNS/SEED_REPORT_DEFS). Zero if the default warehouse connector isn't
   *  seeded yet (see `seedDataDrivenReports`), or once the seed data already exists. */
  dataDrivenReportsSeeded: SeedDataDrivenReportsResult;
  settingsSeeded: number;
  /** Bundled terminology auto-imported on first boot: value sets from the FHIR R4 catalog
   *  and concepts from the full UCUM code system (0/0 once already present or on failure). */
  terminology: { valueSetsImported: number; ucumConceptsImported: number };
  /** Default global report-category list (amr/operational/quality/regulatory) written once on
   *  first boot — see DEFAULT_REPORT_CATEGORIES. 0 once the operator has saved any list. */
  reportCategoriesSeeded: number;
}

/** UCUM canonical url — matches migration 017's `cs-ucum-seed`, so the bundled import merges. */
const UCUM_URL = 'http://unitsofmeasure.org';
/** Bundled-atomic UCUM code absent from migration 017's composed-unit starter — used as the
 *  idempotency marker: if the meter concept exists, the full UCUM bundle is already imported. */
const UCUM_PRESENCE_MARKER = 'm';
/** Publisher stamped on every FHIR R4 catalog value set — used as the catalog presence marker. */
const FHIR_PUBLISHER_ID = 'pub-hl7-fhir';

/** Name used to dedup the default target-warehouse connector — idempotency key. */
const DEFAULT_CONNECTOR_NAME = 'Target Warehouse (Postgres)';

// Minimal structural shape of the forms surface seedDatabase needs. Typed against FormStore
// directly (not AppContext) to keep seed.ts from importing ./index, which re-exports this
// module — that would be a circular dependency. AppContext satisfies this at the call sites.
export interface FormSeedTarget {
  forms: Pick<FormStore, 'list' | 'create' | 'setStatus'>;
  workflows: { store: Pick<WorkflowStore, 'list' | 'create'> };
  // Host connector store + config, threaded from AppContext, so the seed can create a
  // default target-warehouse connector. Structural subset — AppContext satisfies it.
  connectors: Pick<ConnectorStore, 'list' | 'create'>;
  // Dashboards store, threaded the same way so the seed can insert the vetted sample dashboard
  // through the store (bypassing the authoring gate). AppContext.dashboards satisfies this.
  dashboards: { store: Pick<DashboardStore, 'get' | 'create'> };
  // Report-design store, threaded so the seed can insert the default page designs (former studio
  // MOCK_TEMPLATES). Structural subset — AppContext.reportDesigns satisfies it.
  // 'remove' is also needed so the Slice S5 one-shot cleanup can drop retired demo designs on an
  // existing pre-cutover install — see `removeRetiredDemoDesigns`.
  reportDesigns: Pick<ReportDesignStore, 'get' | 'create' | 'remove'>;
  // Report-def store, threaded so the seed can insert the S4 data-driven report records
  // (query+design triples that replace the hardcoded catalog). Structural subset —
  // AppContext.reportDefs satisfies it. Skipped (no-op) until the default warehouse connector
  // (`connectors`, below) exists — see `seedDataDrivenReports`. 'list' is also needed so the
  // Slice S5 demo-design cleanup can guard against deleting a design a report still references.
  reportDefs: Pick<ReportStore, 'get' | 'create' | 'list'>;
  // Terminology surface, threaded so the seed can auto-import the bundled license-safe sets
  // (FHIR R4 catalog + full UCUM) on first boot. Structural subset — AppContext satisfies it.
  terminology: {
    ops: { lookup(system: string, code: string): Promise<{ found: boolean; display?: string | null }> };
    admin: { valueSets: Pick<TerminologyAdminStore['valueSets'], 'list' | 'importFhirCatalog'> };
    loaders: { resource(json: unknown): Promise<{ conceptsLoaded: number }> };
  };
  appSettings: Pick<AppSettingStore, 'get' | 'set'>;
  cfg: { TARGET_DATABASE_URL?: string; SECRETS_ENCRYPTION_KEY?: string };
}

// Idempotent sample-data seed shared by the `openldr db seed` CLI and the server's
// SEED_ON_START path. Persists a minimal org/location/patient set and the bundled sample
// forms (deduped by name, published so they drive their target pages) and a default
// target-warehouse connector. Safe to re-run: existing forms are matched by name and only
// unpublished ones get published; the connector is deduped by name and key-guarded.
export async function seedDatabase(db: DbContext, app: FormSeedTarget): Promise<SeedResult> {
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
  const resources: { id: string; flattened: string }[] = [];
  for (const r of [org, loc, patient]) {
    const out = await db.persist(r, { sourceSystem: 'seed' });
    resources.push({ id: r.id, flattened: out.flattened });
  }

  // Dedup by name, not id: forms.create() always generates a fresh `form-<uuid>` id and
  // ignores the sample's id, so id-based dedup would re-create the samples every run.
  const existingForms = await app.forms.list();
  const existingByName = new Map(existingForms.map((f) => [f.name, f]));
  let orderFormId: string | null = null;
  let formsSeeded = 0;
  for (const form of sampleForms) {
    const existing = existingByName.get(form.name);
    // Capture just id + status — list() yields FormSummary, create() yields FormDefinition.
    let id: string;
    let status: string;
    if (existing) {
      id = existing.id;
      status = existing.status;
    } else {
      const created = await app.forms.create({
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
    if (status !== 'published') await app.forms.setStatus(id, 'published');
    if (form.name === 'Lab order') orderFormId = id;
  }

  // Default workflows — the inbound lab-order ingestion loop + its reactive companion, seeded
  // once each (idempotent by stable id) so a fresh install ships a real, runnable example. The
  // inbound's Form Validate node is bound to the seeded "Lab order" form's actual id, and the
  // webhook secret is generated per-install (so no secret is committed and reseeds never rotate
  // it). Matched by id, not name, so operator-edited copies are never re-created.
  const existingWorkflows = await app.workflows.store.list();
  let workflowsSeeded = 0;
  if (orderFormId) {
    const defaults = buildDefaultWorkflows({ orderFormId, webhookSecret: randomUUID() });
    for (const wf of defaults) {
      if (!existingWorkflows.some((w) => w.id === wf.id)) {
        await app.workflows.store.create(wf);
        workflowsSeeded += 1;
      }
    }
  } else {
    console.warn('[seed] "Lab order" form not found — skipping default workflow seed');
  }

  // Default target-warehouse connector — a ready `type:'postgres'` host connector pointing at
  // TARGET_DATABASE_URL so a fresh install has a connector for workflow DB nodes to select.
  const connectorsSeeded = await seedDefaultConnector(app);

  // Vetted sample dashboard — seeded through the store (id `default`) so the SQL widgets exist
  // without going through the gated HTTP authoring path. Idempotent (store.create no-ops on
  // conflict). Best-effort: a failure here must not abort the rest of the seed.
  let dashboardsSeeded = 0;
  try {
    dashboardsSeeded = await seedDefaultDashboard(app.dashboards.store);
  } catch (e) {
    console.warn('[seed] sample dashboard seed skipped:', e instanceof Error ? e.message : String(e));
  }

  // Report designs — the default free-form page designs (former studio MOCK_TEMPLATES) so a fresh
  // install has designs to open in the report designer. Idempotent (each skips when present by id)
  // and best-effort (never aborts the rest of the seed).
  let reportDesignsSeeded = 0;
  try {
    reportDesignsSeeded = await seedReportDesigns(app.reportDesigns);
  } catch (e) {
    console.warn('[seed] report design seed skipped:', e instanceof Error ? e.message : String(e));
  }

  // Slice S5 one-shot cleanup — the 3 demo designs above were retired from SEED_DESIGNS (the
  // built-ins are now data-driven with their own seeded designs); remove any left over from an
  // existing pre-cutover install, unless a `reports` record still links to one. Idempotent and
  // best-effort (never aborts the rest of the seed).
  let demoDesignsRemoved = 0;
  try {
    demoDesignsRemoved = await removeRetiredDemoDesigns(app.reportDesigns, app.reportDefs);
  } catch (e) {
    console.warn('[seed] retired demo design cleanup skipped:', e instanceof Error ? e.message : String(e));
  }

  // Data-driven reports (S4) — the query/design/report-record triples that migrate the hardcoded
  // report catalog onto the linked (`reports` table) path. Idempotent (each of the three stores
  // skips when the id is already present) and best-effort. The custom-query store is built here
  // from the raw internal-DB handle (rather than threaded through FormSeedTarget) since it isn't
  // otherwise part of AppContext's public surface. Must run AFTER `seedDefaultConnector` above —
  // `seedDataDrivenReports` resolves each seed query's connector by the same `DEFAULT_CONNECTOR_NAME`
  // and skips entirely (no-op) if that connector doesn't exist yet.
  let dataDrivenReportsSeeded: SeedDataDrivenReportsResult = { queriesSeeded: 0, designsSeeded: 0, reportDefsSeeded: 0 };
  try {
    dataDrivenReportsSeeded = await seedDataDrivenReports({
      customQueries: createCustomQueryStore(db.internalDb),
      designs: app.reportDesigns,
      reportDefs: app.reportDefs,
      connectors: app.connectors,
    });
  } catch (e) {
    console.warn('[seed] data-driven report seed skipped:', e instanceof Error ? e.message : String(e));
  }

  // Bundled license-safe terminology (FHIR R4 base catalog + full UCUM) — imported once on a
  // fresh install so Forms coded-field authoring works out of the box. Idempotent (skips when
  // already present) and best-effort (never aborts the rest of the seed).
  const terminology = await seedBundledTerminology(app);

  // Feature-flag defaults — reference config, not demo data. Idempotent: only writes a row
  // when absent, so an operator's later toggle is never clobbered on reseed.
  let settingsSeeded = 0;
  for (const f of FEATURE_FLAGS) {
    const existing = await app.appSettings.get(f.id);
    if (!existing) {
      await app.appSettings.set(f.id, f.default ? 'true' : 'false', 'system');
      settingsSeeded++;
    }
  }

  // Default report categories — the global, editable list backing ReportDef.category (formerly
  // a hardcoded enum). Seeded once, matching the ids the 8 built-in seeded reports already use
  // (see seed/report-seeds.ts), so their grouping is unaffected. Idempotent: only writes when the
  // setting is completely unset, so an operator's later add/rename/reorder/delete always wins on
  // reseed — never clobbered, exactly like the feature-flag defaults above.
  let reportCategoriesSeeded = 0;
  try {
    const existing = await app.appSettings.get(REPORT_CATEGORIES_SETTING_KEY);
    if (!existing) {
      await app.appSettings.set(REPORT_CATEGORIES_SETTING_KEY, JSON.stringify(DEFAULT_REPORT_CATEGORIES), 'system');
      reportCategoriesSeeded = DEFAULT_REPORT_CATEGORIES.length;
    }
  } catch (e) {
    console.warn('[seed] report categories seed skipped:', e instanceof Error ? e.message : String(e));
  }

  return { resources, formsSeeded, workflowsSeeded, connectorsSeeded, dashboardsSeeded, reportDesignsSeeded, demoDesignsRemoved, dataDrivenReportsSeeded, settingsSeeded, terminology, reportCategoriesSeeded };
}

// Auto-import the two bundled, freely-redistributable terminology sets on first boot:
//   1. HL7 FHIR R4 base ValueSet catalog → admin.valueSets.importFhirCatalog (itself idempotent).
//   2. Full UCUM CodeSystem → the generic resource-import loader (upserts by system+code).
// Each step is independently guarded (cheap presence check first) AND independently wrapped so a
// missing fixture or an import failure logs a warning and degrades gracefully — it must NOT abort
// the surrounding seed. Reuses the existing import functions; no hand-rolled DB writes.
async function seedBundledTerminology(app: FormSeedTarget): Promise<SeedResult['terminology']> {
  let valueSetsImported = 0;
  let ucumConceptsImported = 0;

  // (a) FHIR R4 base ValueSet catalog.
  try {
    const existing = await app.terminology.admin.valueSets.list(FHIR_PUBLISHER_ID);
    if (existing.length > 0) {
      // already imported — skip re-reading the ~1MB fixture
    } else {
      const catalog = await readBundledTerminology(BUNDLED_TERMINOLOGY.fhirR4Catalog);
      if (!catalog) {
        console.warn('[seed] FHIR R4 catalog fixture missing — skipping value-set import');
      } else {
        const r = await app.terminology.admin.valueSets.importFhirCatalog(catalog);
        valueSetsImported = r.imported;
        if (r.imported) console.log(`[seed] imported ${r.imported} FHIR R4 value set(s) (${r.skipped} already present)`);
      }
    }
  } catch (e) {
    console.warn('[seed] FHIR R4 catalog import skipped:', e instanceof Error ? e.message : String(e));
  }

  // (b) Full UCUM code system.
  try {
    const marker = await app.terminology.ops.lookup(UCUM_URL, UCUM_PRESENCE_MARKER);
    if (marker.found) {
      // already imported — skip
    } else {
      const ucum = await readBundledTerminology(BUNDLED_TERMINOLOGY.ucumCodeSystem);
      if (!ucum) {
        console.warn('[seed] UCUM CodeSystem fixture missing — skipping UCUM import');
      } else {
        const r = await app.terminology.loaders.resource(ucum);
        ucumConceptsImported = r.conceptsLoaded;
        if (r.conceptsLoaded) console.log(`[seed] imported ${r.conceptsLoaded} UCUM concept(s)`);
      }
    }
  } catch (e) {
    console.warn('[seed] UCUM import skipped:', e instanceof Error ? e.message : String(e));
  }

  return { valueSetsImported, ucumConceptsImported };
}

// Seed one default host connector of type 'postgres', kind 'database' pointing at the target
// warehouse. Idempotent by name. Skips gracefully (with a clear log) when the secrets key is
// unset — connectors.create() would otherwise throw, and `db seed` must still succeed. Returns
// the number of connectors created (0 or 1).
async function seedDefaultConnector(app: FormSeedTarget): Promise<number> {
  if (!app.cfg.SECRETS_ENCRYPTION_KEY) {
    console.log('[seed] SECRETS_ENCRYPTION_KEY unset — skipping default connector');
    return 0;
  }
  if (!app.cfg.TARGET_DATABASE_URL) {
    console.log('[seed] TARGET_DATABASE_URL unset — skipping default connector');
    return 0;
  }
  const existing = await app.connectors.list();
  if (existing.some((c) => c.name === DEFAULT_CONNECTOR_NAME)) return 0; // idempotent by name

  const url = new URL(app.cfg.TARGET_DATABASE_URL);
  await app.connectors.create(
    {
      id: randomUUID(),
      name: DEFAULT_CONNECTOR_NAME,
      type: 'postgres',
      kind: 'database',
      config: {
        host: url.hostname,
        port: url.port || '5432',
        user: decodeURIComponent(url.username),
        password: decodeURIComponent(url.password),
        database: url.pathname.replace(/^\//, ''),
        ssl: url.searchParams.get('sslmode') === 'require' ? 'true' : 'false',
      },
    },
    app.cfg.SECRETS_ENCRYPTION_KEY,
  );
  console.log(`[seed] created default connector "${DEFAULT_CONNECTOR_NAME}"`);
  return 1;
}
