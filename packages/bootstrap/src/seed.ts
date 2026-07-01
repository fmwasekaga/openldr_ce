import { randomUUID } from 'node:crypto';
import { sampleForms, type FormStore } from '@openldr/forms';
import { sampleWorkflow, type WorkflowStore } from '@openldr/workflows';
import { seedDefaultDashboard, type DashboardStore } from '@openldr/dashboards';
import type { ConnectorStore } from '@openldr/db';
import type { DbContext } from './db-context';

export interface SeedResult {
  resources: { id: string; flattened: string }[];
  formsSeeded: number;
  workflowsSeeded: number;
  connectorsSeeded: number;
  dashboardsSeeded: number;
}

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
  }

  // Sample workflow — seeded once (idempotent by stable id) so the Workflows list isn't
  // empty on a fresh install. Matched by id, not name, so a user-renamed copy is never re-created.
  const existingWorkflows = await app.workflows.store.list();
  let workflowsSeeded = 0;
  if (!existingWorkflows.some((w) => w.id === sampleWorkflow.id)) {
    await app.workflows.store.create(sampleWorkflow);
    workflowsSeeded = 1;
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

  return { resources, formsSeeded, workflowsSeeded, connectorsSeeded, dashboardsSeeded };
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
