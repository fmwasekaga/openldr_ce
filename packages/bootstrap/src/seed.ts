import { sampleForms, type FormStore } from '@openldr/forms';
import { sampleWorkflow, type WorkflowStore } from '@openldr/workflows';
import type { DbContext } from './db-context';

export interface SeedResult {
  resources: { id: string; flattened: string }[];
  formsSeeded: number;
  workflowsSeeded: number;
}

// Minimal structural shape of the forms surface seedDatabase needs. Typed against FormStore
// directly (not AppContext) to keep seed.ts from importing ./index, which re-exports this
// module — that would be a circular dependency. AppContext satisfies this at the call sites.
export interface FormSeedTarget {
  forms: Pick<FormStore, 'list' | 'create' | 'setStatus'>;
  workflows: { store: Pick<WorkflowStore, 'list' | 'create'> };
}

// Idempotent sample-data seed shared by the `openldr db seed` CLI and the server's
// SEED_ON_START path. Persists a minimal org/location/patient set and the bundled sample
// forms (deduped by name, published so they drive their target pages). Safe to re-run:
// existing forms are matched by name and only unpublished ones get published.
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

  return { resources, formsSeeded, workflowsSeeded };
}
