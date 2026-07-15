# Distributed Sync S6b — Patient MPI Merge (intra-lab) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sync an operator-decided intra-lab patient merge as a batch of central-authored version bumps (duplicate `Patient` → `replaced-by` survivor; each referencing resource → `subject` re-pointed to survivor) riding S6a's amendment transport, so the lab converges to a unified patient identity.

**Architecture:** A new atomic `FhirStore.mergePatients` primitive version-bumps the duplicate Patient + a caller-supplied list of referencing resources + one merge `Provenance`, all in one internal-DB transaction, writing `sync_amendments` outbox rows (reusing the existing `writeVersion`/`nextVersion` helpers — NOT the public `amend`/allowlist). A bootstrap orchestrator enumerates the referencing resources from the external read model (`ctx.store.db`: the `patient_id` columns of `lab_requests`/`lab_results`/`specimens`/`diagnostic_reports`) and calls the primitive. The merge rides the unchanged amendment stream → `applyRemote` → projection, which re-derives `patient_id` under the survivor; a small `patients` read-model change (`active` + `replaced_by_id`) surfaces the superseded duplicate. Operator surface: CLI + `lab_admin` endpoint.

**Tech Stack:** TypeScript, Kysely (internal DB = Postgres `fhir` schema; external DB = analytics warehouse), pg-mem tests, Fastify, Commander, Vitest, pnpm/turbo. Spec: `docs/superpowers/specs/2026-07-15-distributed-sync-s6b-patient-merge-design.md`.

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `packages/db/src/fhir-store.ts` | `mergePatients` primitive, `MergeResult`, `PatientNotFoundError`/`CrossSiteMergeError`/`SamePatientError`, `latestSite` helper | Modify |
| `packages/db/src/fhir-store-merge.test.ts` | Primitive unit tests | Create |
| `packages/db/src/migrations/external/00X_patients_merge.ts` | `patients.active` + `patients.replaced_by_id` | Create |
| `packages/db/src/migrations/external/index.ts` | Register the migration | Modify |
| `packages/db/src/schema/external.ts` | `PatientsTable` gains `active` + `replaced_by_id` | Modify |
| `packages/db/src/relational/patient.ts` | `projectPatient` reads `active` + `replaced_by_id` | Modify |
| `packages/db/src/relational/patient.test.ts` (or existing relational test) | projectPatient unit test | Modify/Create |
| `packages/db/src/export-data.ts` | add the 2 columns to the `patients` column list | Modify |
| `packages/bootstrap/src/patient-merge.ts` | `mergePatients` orchestrator (enumerate + call primitive) | Create |
| `packages/bootstrap/src/index.ts` | export the orchestrator from the barrel | Modify |
| `apps/server/src/settings-routes.ts` | `POST /api/settings/sync/merge-patient` | Modify |
| `packages/cli/src/sync.ts` + `index.ts` | `openldr sync merge-patient` | Modify |
| `scripts/sync-patient-merge-live-acceptance.ts` | round-trip acceptance | Create |
| `package.json` (root) | `sync:patient-merge:accept` | Modify |
| `docs/{CLI-REFERENCE,HTTP-API,OPERATOR-GUIDE}.md` | merge-patient usage | Modify |

**Key contracts:**
- `MergeInput = { survivorId: string; duplicateId: string; agent: string; reason?: string; referencingRefs: { resourceType: string; id: string }[] }`
- `MergeResult = { survivorId: string; duplicateId: string; repointed: number; provenanceId: string; siteId: string }`
- `FhirStore.mergePatients(input: MergeInput): Promise<MergeResult>`
- Read-model → FHIR type map (for enumeration): `lab_requests`→`ServiceRequest`, `lab_results`→`Observation`, `specimens`→`Specimen`, `diagnostic_reports`→`DiagnosticReport`. Each table's `id` column IS the FHIR resource id.

---

## Task 1: `mergePatients` primitive

**Files:**
- Modify: `packages/db/src/fhir-store.ts`
- Test: `packages/db/src/fhir-store-merge.test.ts`

Read `packages/db/src/fhir-store.ts` first: `nextVersion` (~line 101), `writeVersion` (~line 114), the `amend` method (~line 326) for idiom, and the `AmendInput`/error-class block (~line 32-56).

- [ ] **Step 1: Write the failing tests** `packages/db/src/fhir-store-merge.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { Kysely } from 'kysely';
import { createFhirStore, PatientNotFoundError, CrossSiteMergeError, SamePatientError } from './fhir-store';
import { makeMigratedDb } from './migrations/internal/test-helpers'; // same helper the amend tests use — confirm the path

async function seedPatient(store: ReturnType<typeof createFhirStore>, id: string, site: string) {
  await store.applyRemote({ resourceType: 'Patient', id, version: 1, op: 'upsert', siteId: site, resource: { resourceType: 'Patient', id, active: true, name: [{ family: id }] } as any });
}
async function seedRef(store: ReturnType<typeof createFhirStore>, resourceType: string, id: string, patientId: string, site: string) {
  await store.applyRemote({ resourceType, id, version: 1, op: 'upsert', siteId: site, resource: { resourceType, id, subject: { reference: `Patient/${patientId}` } } as any });
}

describe('FhirStore.mergePatients', () => {
  let db: Kysely<any>;
  beforeEach(async () => { db = await makeMigratedDb(); });

  it('marks the duplicate replaced, re-points referencing resources, writes a merge Provenance + outbox rows', async () => {
    const store = createFhirStore(db);
    await seedPatient(store, 'p-surv', 'lab-a');
    await seedPatient(store, 'p-dup', 'lab-a');
    await seedRef(store, 'Observation', 'obs-1', 'p-dup', 'lab-a');
    await seedRef(store, 'ServiceRequest', 'sr-1', 'p-dup', 'lab-a');

    const result = await store.mergePatients({
      survivorId: 'p-surv', duplicateId: 'p-dup', agent: 'mpi', reason: 'same person',
      referencingRefs: [{ resourceType: 'Observation', id: 'obs-1' }, { resourceType: 'ServiceRequest', id: 'sr-1' }],
    });

    expect(result.repointed).toBe(2);
    expect(result.siteId).toBe('lab-a');

    const dup = (await store.get('Patient', 'p-dup')) as any;
    expect(dup.active).toBe(false);
    expect(dup.link).toContainEqual({ type: 'replaced-by', other: { reference: 'Patient/p-surv' } });
    expect(dup.meta.versionId).toBe('2');

    const obs = (await store.get('Observation', 'obs-1')) as any;
    expect(obs.subject.reference).toBe('Patient/p-surv');
    const sr = (await store.get('ServiceRequest', 'sr-1')) as any;
    expect(sr.subject.reference).toBe('Patient/p-surv');

    const prov = (await store.get('Provenance', result.provenanceId)) as any;
    expect(prov.activity.coding[0].code).toBe('MERGE');
    expect(prov.target).toEqual(expect.arrayContaining([
      { reference: 'Patient/p-dup' }, { reference: 'Observation/obs-1' }, { reference: 'ServiceRequest/sr-1' },
    ]));

    // outbox: duplicate Patient + 2 refs + Provenance = 4 rows, all lab-a.
    const outbox = await db.selectFrom('sync_amendments').selectAll().where('site_id', '=', 'lab-a').execute();
    expect(outbox).toHaveLength(4);
    expect(outbox.map((r) => r.resource_type).sort()).toEqual(['Observation', 'Patient', 'Provenance', 'ServiceRequest']);
  });

  it('rejects a cross-site merge (patients owned by different sites)', async () => {
    const store = createFhirStore(db);
    await seedPatient(store, 'p-surv', 'lab-b');
    await seedPatient(store, 'p-dup', 'lab-a');
    await expect(store.mergePatients({ survivorId: 'p-surv', duplicateId: 'p-dup', agent: 'mpi', referencingRefs: [] })).rejects.toBeInstanceOf(CrossSiteMergeError);
  });

  it('rejects merging a patient into itself', async () => {
    const store = createFhirStore(db);
    await seedPatient(store, 'p-1', 'lab-a');
    await expect(store.mergePatients({ survivorId: 'p-1', duplicateId: 'p-1', agent: 'mpi', referencingRefs: [] })).rejects.toBeInstanceOf(SamePatientError);
  });

  it('rejects when a patient does not exist', async () => {
    const store = createFhirStore(db);
    await seedPatient(store, 'p-surv', 'lab-a');
    await expect(store.mergePatients({ survivorId: 'p-surv', duplicateId: 'nope', agent: 'mpi', referencingRefs: [] })).rejects.toBeInstanceOf(PatientNotFoundError);
  });

  it('skips a stale referencing ref that no longer exists (does not fail the merge)', async () => {
    const store = createFhirStore(db);
    await seedPatient(store, 'p-surv', 'lab-a');
    await seedPatient(store, 'p-dup', 'lab-a');
    const result = await store.mergePatients({ survivorId: 'p-surv', duplicateId: 'p-dup', agent: 'mpi', referencingRefs: [{ resourceType: 'Observation', id: 'ghost' }] });
    expect(result.repointed).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @openldr/db exec vitest run src/fhir-store-merge.test.ts`
Expected: FAIL — `mergePatients`/error classes not exported.

- [ ] **Step 3: Add error classes + types**

In `packages/db/src/fhir-store.ts`, after the existing error classes (~line 56, wherever `UnsupportedResourceTypeError` is) add:

```typescript
export class PatientNotFoundError extends Error {
  constructor(message: string) { super(message); this.name = 'PatientNotFoundError'; }
}
export class CrossSiteMergeError extends Error {
  constructor(message: string) { super(message); this.name = 'CrossSiteMergeError'; }
}
export class SamePatientError extends Error {
  constructor(message: string) { super(message); this.name = 'SamePatientError'; }
}

export interface MergeInput {
  survivorId: string;
  duplicateId: string;
  agent: string; // Provenance agent.who.display
  reason?: string;
  referencingRefs: { resourceType: string; id: string }[]; // enumerated by the caller (read-model reverse index)
}
export interface MergeResult {
  survivorId: string;
  duplicateId: string;
  repointed: number; // count of referencing resources actually re-pointed (stale ones skipped)
  provenanceId: string;
  siteId: string; // owning lab
}
```

Add to the `FhirStore` interface (after `amend`):

```typescript
  // Sync S6b: atomically author an intra-lab patient merge — mark the duplicate Patient replaced
  // (active:false + link replaced-by survivor), re-point each referencing resource's subject to the
  // survivor, write one merge Provenance, and emit sync_amendments outbox rows. One transaction.
  mergePatients(input: MergeInput): Promise<MergeResult>;
```

- [ ] **Step 4: Add a `latestSite` helper**

Alongside `nextVersion`/`writeVersion` inside `createFhirStore` (before `return {`), add:

```typescript
  // Sync S6b: the owning-lab site_id = the site on a resource's latest change_log row (same lookup amend
  // does inline). Empty string when unstamped (central-owned / unsynced).
  async function latestSite(trx: Kysely<InternalSchema>, resourceType: string, id: string): Promise<string> {
    const owner = await trx
      .selectFrom('fhir.change_log')
      .select('site_id')
      .where('resource_type', '=', resourceType)
      .where('resource_id', '=', id)
      .orderBy('version', 'desc')
      .limit(1)
      .executeTakeFirst();
    return owner?.site_id ?? '';
  }
```

- [ ] **Step 5: Implement `mergePatients`**

Add to the returned object (after `amend`):

```typescript
    async mergePatients(input) {
      const { survivorId, duplicateId, agent, reason, referencingRefs } = input;
      if (survivorId === duplicateId) throw new SamePatientError('survivor and duplicate are the same patient');
      const provenanceId = randomUUID();
      const result = await db.transaction().execute(async (trx): Promise<MergeResult> => {
        // Both patients must exist.
        const dupRow = await trx.selectFrom('fhir.fhir_resources').select('resource').where('resource_type', '=', 'Patient').where('id', '=', duplicateId).executeTakeFirst();
        if (!dupRow) throw new PatientNotFoundError(`Patient/${duplicateId} not found`);
        const survRow = await trx.selectFrom('fhir.fhir_resources').select('resource').where('resource_type', '=', 'Patient').where('id', '=', survivorId).executeTakeFirst();
        if (!survRow) throw new PatientNotFoundError(`Patient/${survivorId} not found`);

        // Intra-lab: both patients must be owned by the same (non-empty) site.
        const site = await latestSite(trx, 'Patient', duplicateId);
        const survSite = await latestSite(trx, 'Patient', survivorId);
        if (!site || !survSite || site !== survSite) throw new CrossSiteMergeError('patients are not owned by the same site');

        const nowIso = new Date().toISOString();
        const targets: { reference: string }[] = [];
        const outboxRows: { site_id: string; resource_type: string; resource_id: string; version: number }[] = [];

        // 1. Duplicate Patient → inactive + link replaced-by survivor.
        const dupBody = dupRow.resource as Record<string, unknown>;
        const existingLinks = Array.isArray(dupBody['link']) ? (dupBody['link'] as unknown[]) : [];
        const dupVersion = await nextVersion(trx, 'Patient', duplicateId);
        const dupNew: Record<string, unknown> = {
          ...dupBody, id: duplicateId, active: false,
          link: [...existingLinks, { type: 'replaced-by', other: { reference: `Patient/${survivorId}` } }],
          meta: { ...(dupBody['meta'] as Record<string, unknown> | undefined), versionId: String(dupVersion), lastUpdated: nowIso },
        };
        await writeVersion(trx, { resourceType: 'Patient', id: duplicateId, version: dupVersion, body: dupNew, siteId: site });
        targets.push({ reference: `Patient/${duplicateId}` });
        outboxRows.push({ site_id: site, resource_type: 'Patient', resource_id: duplicateId, version: dupVersion });

        // 2. Re-point each referencing resource's subject → survivor. A stale ref (no longer present) is skipped.
        let repointed = 0;
        for (const ref of referencingRefs) {
          const row = await trx.selectFrom('fhir.fhir_resources').select('resource').where('resource_type', '=', ref.resourceType).where('id', '=', ref.id).executeTakeFirst();
          if (!row) continue;
          const body = row.resource as Record<string, unknown>;
          const v = await nextVersion(trx, ref.resourceType, ref.id);
          const newBody: Record<string, unknown> = {
            ...body, id: ref.id, subject: { reference: `Patient/${survivorId}` },
            meta: { ...(body['meta'] as Record<string, unknown> | undefined), versionId: String(v), lastUpdated: nowIso },
          };
          await writeVersion(trx, { resourceType: ref.resourceType, id: ref.id, version: v, body: newBody, siteId: site });
          targets.push({ reference: `${ref.resourceType}/${ref.id}` });
          outboxRows.push({ site_id: site, resource_type: ref.resourceType, resource_id: ref.id, version: v });
          repointed++;
        }

        // 3. One merge Provenance (new resource → v1) targeting all changed resources.
        const provBody: Record<string, unknown> = {
          resourceType: 'Provenance', id: provenanceId, target: targets, recorded: nowIso,
          activity: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v3-DataOperation', code: 'MERGE', display: 'merge' }] },
          agent: [{ who: { display: agent } }],
          ...(reason ? { reason: [{ text: reason }] } : {}),
          meta: { versionId: '1', lastUpdated: nowIso },
        };
        await writeVersion(trx, { resourceType: 'Provenance', id: provenanceId, version: 1, body: provBody, siteId: site });
        outboxRows.push({ site_id: site, resource_type: 'Provenance', resource_id: provenanceId, version: 1 });

        // 4. Outbox rows for the whole cascade.
        await trx.insertInto('sync_amendments').values(outboxRows).execute();

        return { survivorId, duplicateId, repointed, provenanceId, siteId: site };
      });
      try { await sql`select pg_notify('fhir_changes', '')`.execute(db); } catch { /* ignore */ }
      return result;
    },
```

- [ ] **Step 6: Barrel** — `packages/db/src/index.ts` uses `export * from './fhir-store'`, so the new symbols auto-export. Verify.

- [ ] **Step 7: Run tests + typecheck**

Run: `pnpm --filter @openldr/db exec vitest run src/fhir-store-merge.test.ts` → PASS (all 5).
Run: `pnpm --filter @openldr/db exec tsc --noEmit` → clean.

- [ ] **Step 8: Commit**

```bash
git add packages/db/src/fhir-store.ts packages/db/src/fhir-store-merge.test.ts packages/db/src/index.ts
git commit -m "feat(db): mergePatients atomic intra-lab merge primitive (sync S6b)"
```
(No `Co-Authored-By` trailer.)

---

## Task 2: `patients` read-model marker (`active` + `replaced_by_id`)

**Files:**
- Create: `packages/db/src/migrations/external/00X_patients_merge.ts` (find the next number)
- Modify: `packages/db/src/migrations/external/index.ts`, `packages/db/src/schema/external.ts`, `packages/db/src/relational/patient.ts`, `packages/db/src/export-data.ts`
- Test: `packages/db/src/relational/patient.test.ts` (create if absent; otherwise extend the relational test)

- [ ] **Step 1: Write the failing projection test** — a pure-function unit test for `projectPatient`:

```typescript
// packages/db/src/relational/patient.test.ts
import { describe, it, expect } from 'vitest';
import { projectPatient } from './patient';

describe('projectPatient active/replaced_by_id', () => {
  it('defaults active to true and replaced_by_id to null for a plain patient', () => {
    const out = projectPatient({ resourceType: 'Patient', id: 'p1', name: [{ family: 'X' }] }, {});
    expect(out.active).toBe(true);
    expect(out.replaced_by_id).toBeNull();
  });
  it('reads active:false and extracts the replaced-by link target', () => {
    const out = projectPatient({ resourceType: 'Patient', id: 'p-dup', active: false, link: [{ type: 'replaced-by', other: { reference: 'Patient/p-surv' } }] }, {});
    expect(out.active).toBe(false);
    expect(out.replaced_by_id).toBe('p-surv');
  });
});
```

Run: `pnpm --filter @openldr/db exec vitest run src/relational/patient.test.ts` → FAIL (fields absent).

- [ ] **Step 2: Add the migration** — first find the highest existing external migration number in `packages/db/src/migrations/external/` and its index registration idiom (read `index.ts` there; it lists them like the internal one). Create `00X_patients_merge.ts` (X = next number) mirroring a recent external migration's structure:

```typescript
import { type Kysely, sql } from 'kysely';

// Sync S6b: surface an intra-lab patient merge in the read model. `active` mirrors Patient.active;
// `replaced_by_id` is the survivor id from the Patient's replaced-by link. Defaults keep existing rows
// correct (active, not replaced). Runs on the external/analytics DB (down() only on real engines).
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable('patients').addColumn('active', 'boolean', (c) => c.notNull().defaultTo(true)).execute();
  await db.schema.alterTable('patients').addColumn('replaced_by_id', 'text').execute();
}
export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable('patients').dropColumn('replaced_by_id').execute();
  await db.schema.alterTable('patients').dropColumn('active').execute();
}
```

Register it in `packages/db/src/migrations/external/index.ts` (import + append to the migrations record, exactly matching the existing idiom). If there is an external migrations test asserting the key list, update it.

- [ ] **Step 3: Update the `PatientsTable` type** in `packages/db/src/schema/external.ts` — add to the interface:

```typescript
  active: Generated<boolean>;
  replaced_by_id: string | null;
```
(Match the file's import of `Generated`; if the table type doesn't use `Generated` elsewhere, use `boolean` and `string | null` and rely on the DB default.)

- [ ] **Step 4: Update `projectPatient`** (`packages/db/src/relational/patient.ts`) — add to the returned object:

```typescript
    active: r['active'] === undefined || r['active'] === null ? true : Boolean(r['active']),
    replaced_by_id: (() => {
      const links = (r['link'] as Record<string, unknown>[] | undefined) ?? [];
      const rep = links.find((l) => l['type'] === 'replaced-by');
      const ref = (rep?.['other'] as Record<string, unknown> | undefined)?.['reference'];
      return typeof ref === 'string' && ref.startsWith('Patient/') ? ref.slice('Patient/'.length) : null;
    })(),
```

- [ ] **Step 5: Update `export-data.ts`** — if `packages/db/src/export-data.ts` lists the `patients` columns explicitly (it lists other tables' columns), add `'active'` and `'replaced_by_id'` to the `patients` column array so exports include them. If it selects `*`, no change.

- [ ] **Step 6: Run tests + typecheck**

Run: `pnpm --filter @openldr/db exec vitest run src/relational/patient.test.ts` (+ any external migration test) → PASS.
Run: `pnpm --filter @openldr/db exec tsc --noEmit` → clean.

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/migrations/external/ packages/db/src/schema/external.ts packages/db/src/relational/patient.ts packages/db/src/relational/patient.test.ts packages/db/src/export-data.ts
git commit -m "feat(db): patients.active + replaced_by_id read-model merge marker (sync S6b)"
```

---

## Task 3: bootstrap `mergePatients` orchestrator (enumerate + call primitive)

**Files:**
- Create: `packages/bootstrap/src/patient-merge.ts`
- Modify: `packages/bootstrap/src/index.ts` (barrel export)
- Test: `packages/bootstrap/src/patient-merge.test.ts`

The orchestrator enumerates referencing resource ids from the external read model (`ctx.store.db` as `Kysely<ExternalSchema>`) across the 4 `patient_id` tables, maps each to its FHIR type, and calls `ctx.fhirStore.mergePatients`.

- [ ] **Step 1: Write the failing test** — `packages/bootstrap/src/patient-merge.test.ts` with a fake ctx (an in-memory external db via pg-mem seeded with the 4 tables, or a stub `store.db` returning canned rows, plus a `fhirStore.mergePatients` spy):

```typescript
import { describe, it, expect, vi } from 'vitest';
import { mergePatients } from './patient-merge';

it('enumerates referencing refs from the read model and calls fhirStore.mergePatients', async () => {
  const merge = vi.fn(async () => ({ survivorId: 'p-surv', duplicateId: 'p-dup', repointed: 2, provenanceId: 'prov-1', siteId: 'lab-a' }));
  // store.db stub: each selectFrom(<table>).where('patient_id','=','p-dup') returns rows of {id}.
  const rowsByTable: Record<string, { id: string }[]> = {
    lab_requests: [{ id: 'sr-1' }], lab_results: [{ id: 'obs-1' }], specimens: [], diagnostic_reports: [],
  };
  const storeDb = { selectFrom: (t: string) => ({ select: () => ({ where: () => ({ execute: async () => rowsByTable[t] }) }) }) };
  const ctx: any = { store: { db: storeDb }, fhirStore: { mergePatients: merge } };

  const result = await mergePatients(ctx, { survivorId: 'p-surv', duplicateId: 'p-dup', agent: 'mpi' });
  expect(result.repointed).toBe(2);
  expect(merge).toHaveBeenCalledWith(expect.objectContaining({
    survivorId: 'p-surv', duplicateId: 'p-dup', agent: 'mpi',
    referencingRefs: expect.arrayContaining([
      { resourceType: 'ServiceRequest', id: 'sr-1' }, { resourceType: 'Observation', id: 'obs-1' },
    ]),
  }));
});
```

(Adapt the `storeDb` stub to the real Kysely call chain `selectFrom(t).select('id').where('patient_id','=',dup).execute()` — a minimal chainable stub as above, or use a real pg-mem external db seeded with the 4 tables. Prefer whichever sibling bootstrap tests use for the external db.)

Run: `pnpm --filter @openldr/bootstrap exec vitest run src/patient-merge.test.ts` → FAIL (module missing).

- [ ] **Step 2: Implement the orchestrator** `packages/bootstrap/src/patient-merge.ts`:

```typescript
import type { Kysely } from 'kysely';
import type { ExternalSchema } from '@openldr/db';
import type { MergeResult } from '@openldr/db';
import type { AppContext } from './index';

// Sync S6b: read-model → FHIR resource type. Each table's `id` column is the FHIR resource id, and its
// `patient_id` column is the denormalized subject Patient id — the reverse index of "what references
// this patient".
const REF_TABLES: { table: keyof ExternalSchema & string; resourceType: string }[] = [
  { table: 'lab_requests', resourceType: 'ServiceRequest' },
  { table: 'lab_results', resourceType: 'Observation' },
  { table: 'specimens', resourceType: 'Specimen' },
  { table: 'diagnostic_reports', resourceType: 'DiagnosticReport' },
];

/** Orchestrate an intra-lab patient merge (Sync S6b): enumerate the resources referencing the duplicate
 *  from the external read model, then delegate the atomic version-bump cascade to fhirStore.mergePatients.
 *  Enumeration limitation (documented): a ref pushed up but not yet projected at central is missed; a
 *  re-run picks it up (re-point is idempotent). */
export async function mergePatients(
  ctx: AppContext,
  input: { survivorId: string; duplicateId: string; agent: string; reason?: string },
): Promise<MergeResult> {
  const edb = ctx.store.db as unknown as Kysely<ExternalSchema>;
  const referencingRefs: { resourceType: string; id: string }[] = [];
  for (const { table, resourceType } of REF_TABLES) {
    const rows = await edb.selectFrom(table).select('id').where('patient_id', '=', input.duplicateId).execute();
    for (const row of rows) referencingRefs.push({ resourceType, id: String((row as { id: unknown }).id) });
  }
  return ctx.fhirStore.mergePatients({ ...input, referencingRefs });
}
```

Verify `ExternalSchema` and `MergeResult` are exported from `@openldr/db` (both should be — external schema is exported for the relational writer; `MergeResult` was added in Task 1). If `ExternalSchema` isn't re-exported from the `@openldr/db` barrel, import it from its path or add the export.

- [ ] **Step 3: Export from the barrel** — in `packages/bootstrap/src/index.ts`, add `mergePatients` to the exports (near where `serveAmendments`/other sync helpers are exported):

```typescript
export { mergePatients } from './patient-merge';
```

- [ ] **Step 4: Run tests + typecheck**

Run: `pnpm --filter @openldr/bootstrap exec vitest run src/patient-merge.test.ts` → PASS.
Run: `pnpm --filter @openldr/bootstrap exec tsc --noEmit` → clean.

- [ ] **Step 5: Commit**

```bash
git add packages/bootstrap/src/patient-merge.ts packages/bootstrap/src/index.ts packages/bootstrap/src/patient-merge.test.ts
git commit -m "feat(bootstrap): mergePatients orchestrator — enumerate refs + cascade (sync S6b)"
```

---

## Task 4: `POST /api/settings/sync/merge-patient` endpoint

**Files:**
- Modify: `apps/server/src/settings-routes.ts`
- Test: `apps/server/src/settings-sync-routes.test.ts`

Read the existing `/api/settings/sync/amend` handler (`settings-routes.ts:72`) and its tests for the exact harness (`fakeCtx`, `adminApp`, audit capture). `mergePatients` is imported from `@openldr/bootstrap`.

- [ ] **Step 1: Write the failing tests** — using the file's harness idiom:

```typescript
  it('merges patients and returns 200 with the result', async () => {
    const ctx = fakeCtx();
    // Make bootstrap.mergePatients resolve — the route calls the imported mergePatients(ctx, {...}).
    // Since it's a module import, stub it via the same mechanism the amend tests use for ctx.fhirStore,
    // OR (preferred) give fakeCtx a store.db + fhirStore.mergePatients so the real orchestrator runs.
    // Simplest: assert the route wires input → mergePatients and maps the result to 200.
    const res = await adminApp(ctx).inject({ method: 'POST', url: '/api/settings/sync/merge-patient', payload: { survivorId: 'p-surv', duplicateId: 'p-dup' } });
    expect(res.statusCode).toBe(200);
  });

  it('maps SamePatientError→400, PatientNotFoundError→404, CrossSiteMergeError→409', async () => {
    // three sub-cases, each making mergePatients reject with the named error (Object.assign(new Error(), {name}))
  });
```

Because the route calls the module-level `mergePatients(ctx, …)` import (not `ctx.mergePatients`), the cleanest testable design is: **have the route call `ctx.fhirStore.mergePatients` via the orchestrator by injecting the orchestrator, OR call the bootstrap `mergePatients(ctx, …)` and stub it with `vi.mock('@openldr/bootstrap', …)`.** Follow whatever the settings-route tests already do for bootstrap-imported helpers (e.g. how enroll/rotate are tested — they call bootstrap `enrollSite`; copy that mocking approach). Match it exactly.

Run: `pnpm --filter @openldr/server exec vitest run src/settings-sync-routes.test.ts` → FAIL (route 404).

- [ ] **Step 2: Implement the route** — add `mergePatients` to the `@openldr/bootstrap` import in `settings-routes.ts`, then add after the amend handler:

```typescript
  // POST /api/settings/sync/merge-patient — intra-lab patient merge (Sync S6b). lab_admin, user-authed.
  // Delegates to the bootstrap orchestrator (enumerate refs + atomic cascade); the merge then flows down
  // the owning lab's amendment stream. Audited PHI-free: patient ids + counts only.
  app.post('/api/settings/sync/merge-patient', { preHandler: requireRole('lab_admin') }, async (req, reply) => {
    const b = (req.body ?? {}) as { survivorId?: unknown; duplicateId?: unknown; reason?: unknown; agent?: unknown };
    if (typeof b.survivorId !== 'string' || !b.survivorId || typeof b.duplicateId !== 'string' || !b.duplicateId) {
      reply.code(400).send({ error: 'survivorId and duplicateId are required' });
      return;
    }
    try {
      const result = await mergePatients(ctx, {
        survivorId: b.survivorId, duplicateId: b.duplicateId,
        reason: typeof b.reason === 'string' ? b.reason : undefined,
        agent: typeof b.agent === 'string' && b.agent ? b.agent : 'central',
      });
      await recordAudit(ctx, req, {
        action: 'settings.sync.merge', entityType: 'Patient', entityId: b.duplicateId,
        metadata: { survivorId: result.survivorId, duplicateId: result.duplicateId, repointed: result.repointed, provenanceId: result.provenanceId },
      });
      reply.code(200).send(result);
    } catch (e) {
      const name = e instanceof Error ? e.name : '';
      if (name === 'SamePatientError') { reply.code(400).send({ error: 'survivor and duplicate are the same patient' }); return; }
      if (name === 'PatientNotFoundError') { reply.code(404).send({ error: 'patient not found' }); return; }
      if (name === 'CrossSiteMergeError') { reply.code(409).send({ error: 'patients are not owned by the same site' }); return; }
      throw e;
    }
  });
```

- [ ] **Step 3: Run tests + typecheck**

Run: `pnpm --filter @openldr/server exec vitest run src/settings-sync-routes.test.ts` → PASS.
Run: `pnpm --filter @openldr/server exec tsc --noEmit` → clean.

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/settings-routes.ts apps/server/src/settings-sync-routes.test.ts
git commit -m "feat(server): POST /api/settings/sync/merge-patient (sync S6b)"
```

---

## Task 5: `openldr sync merge-patient` CLI

**Files:**
- Modify: `packages/cli/src/sync.ts`, `packages/cli/src/index.ts`
- Test: `packages/cli/src/sync-merge-patient.test.ts`

Read `runSyncAmend` in `sync.ts` and the `sync amend` registration in `index.ts` for the idiom; `mergePatients` is imported from `@openldr/bootstrap`.

- [ ] **Step 1: Write the failing test** `packages/cli/src/sync-merge-patient.test.ts` (mirror `sync-amend.test.ts`'s `vi.hoisted` + `vi.mock('@openldr/bootstrap', …)` idiom, mocking `createAppContext` AND `mergePatients`):

```typescript
import { describe, it, expect, vi } from 'vitest';
const merge = vi.hoisted(() => vi.fn(async () => ({ survivorId: 'p-surv', duplicateId: 'p-dup', repointed: 2, provenanceId: 'prov-1', siteId: 'lab-a' })));
const close = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('@openldr/bootstrap', () => ({ createAppContext: async () => ({ close }), mergePatients: merge }));
vi.mock('@openldr/config', () => ({ loadConfig: () => ({}) }));
import { runSyncMergePatient } from './sync';

describe('runSyncMergePatient', () => {
  it('calls mergePatients and returns 0', async () => {
    const code = await runSyncMergePatient({ survivor: 'p-surv', duplicate: 'p-dup', reason: 'same', json: true });
    expect(code).toBe(0);
    expect(merge).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ survivorId: 'p-surv', duplicateId: 'p-dup' }));
  });
  it('returns 1 on missing options', async () => {
    expect(await runSyncMergePatient({ survivor: '', duplicate: '', json: true })).toBe(1);
  });
  it('maps CrossSiteMergeError to a friendly exit 1', async () => {
    merge.mockRejectedValueOnce(Object.assign(new Error('x'), { name: 'CrossSiteMergeError' }));
    expect(await runSyncMergePatient({ survivor: 'a', duplicate: 'b', json: true })).toBe(1);
  });
});
```

Run: `pnpm --filter @openldr/cli exec vitest run src/sync-merge-patient.test.ts` → FAIL (not exported).

- [ ] **Step 2: Implement `runSyncMergePatient`** in `packages/cli/src/sync.ts` — add `mergePatients` to the `@openldr/bootstrap` import, then after `runSyncAmend`:

```typescript
// `openldr sync merge-patient` — intra-lab patient merge (Sync S6b). Runs on central.
export async function runSyncMergePatient(opts: { survivor?: string; duplicate?: string; reason?: string; agent?: string; json?: boolean }): Promise<number> {
  const json = opts.json ?? false;
  if (!opts.survivor || !opts.duplicate) return fail(json, '--survivor and --duplicate are required');
  const ctx = await createAppContext(loadConfig());
  try {
    const result = await mergePatients(ctx, { survivorId: opts.survivor, duplicateId: opts.duplicate, reason: opts.reason, agent: opts.agent ?? 'central' });
    emit(json, result, [
      `survivor   = ${result.survivorId}`,
      `duplicate  = ${result.duplicateId}`,
      `repointed  = ${result.repointed}`,
      `provenance = ${result.provenanceId}`,
      `owningSite = ${result.siteId}`,
    ].join('\n'));
    return 0;
  } catch (err) {
    switch (err instanceof Error ? err.name : '') {
      case 'SamePatientError': return fail(json, 'survivor and duplicate are the same patient');
      case 'PatientNotFoundError': return fail(json, 'patient not found');
      case 'CrossSiteMergeError': return fail(json, 'patients are not owned by the same site (intra-lab merge only)');
      default: return fail(json, `sync merge-patient failed: ${redactError(err)}`);
    }
  } finally {
    await ctx.close();
  }
}
```

- [ ] **Step 3: Register the command** in `packages/cli/src/index.ts` — add `runSyncMergePatient` to the `./sync` import, then in the `syncGroup` block:

```typescript
syncGroup.command('merge-patient')
  .description('Merge a duplicate patient into a survivor (central, intra-lab) — re-points the patient\'s lab history')
  .requiredOption('--survivor <id>', 'the canonical Patient id to keep')
  .requiredOption('--duplicate <id>', 'the duplicate Patient id to replace')
  .option('--reason <text>', 'merge reason (recorded on the Provenance)')
  .option('--agent <name>', 'merging agent name', 'central')
  .option('--json', 'emit JSON', false)
  .action(async (opts) => {
    try { process.exitCode = await runSyncMergePatient(opts); } catch (err) { process.stderr.write(`sync merge-patient failed: ${redactError(err)}\n`); process.exitCode = 1; }
  });
```

- [ ] **Step 4: Run tests + typecheck**

Run: `pnpm --filter @openldr/cli exec vitest run src/sync-merge-patient.test.ts` → PASS.
Run: `pnpm --filter @openldr/cli exec tsc --noEmit` → clean.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/sync.ts packages/cli/src/index.ts packages/cli/src/sync-merge-patient.test.ts
git commit -m "feat(cli): openldr sync merge-patient (sync S6b)"
```

---

## Task 6: Patient-merge two-DB live acceptance

**Files:**
- Create: `scripts/sync-patient-merge-live-acceptance.ts`
- Modify: `package.json` (root) — `sync:patient-merge:accept`

Model EXACTLY on `scripts/sync-order-status-live-acceptance.ts` (S6c — two internal DBs central+lab + a lab TARGET DB, in-process serve/apply, genuinely drives the projection runner). Read it fully and copy its connect/provision/migrate/teardown + `assert` + projection-drive helpers verbatim. Dev Postgres up (`docker compose up -d postgres`).

- [ ] **Step 1: Write the acceptance script** proving:
  1. Lab creates two Patients (`p-surv`, `p-dup`) + an Observation `obs-1` and a ServiceRequest `sr-1` both `subject: Patient/p-dup`, mirrored to central + lab via `applyRemote` (v1, siteId=SITE). Seed both the lab internal DB and central internal DB; ALSO project central so `lab_results`/`lab_requests` have `patient_id = p-dup` (drive central's projection into central's target DB — the orchestrator enumerates from there).
  2. Central runs the orchestrator: `mergePatients(centralCtx, { survivorId: 'p-surv', duplicateId: 'p-dup', agent: 'mpi', reason: 'same person' })` (build a minimal `centralCtx = { store: { db: centralTargetDb }, fhirStore: centralStore }` — the orchestrator only touches `ctx.store.db` + `ctx.fhirStore`). Assert `repointed === 2`, `siteId === SITE`.
  3. Lab drains the amendment stream in-process (`createAmendmentPullRunner` → `serveAmendments(centralCtx2, SITE, fromSeq)` where `centralCtx2 = { internalDb: centralInternal, logger }`, applyRecord = labStore.applyRemote). Assert it applies 4 records (dup Patient + 2 refs + Provenance).
  4. Lab convergence (FHIR): `Patient/p-dup` is `active:false` + link replaced-by `Patient/p-surv`; `obs-1`/`sr-1` now `subject: Patient/p-surv`; the merge Provenance landed with activity `MERGE`.
  5. Lab read model (drive the lab projection runner as the S6c harness does): `lab_results.patient_id` for obs-1 and `lab_requests.patient_id` for sr-1 are now `p-surv`; the `patients` row for `p-dup` has `active = false` and `replaced_by_id = 'p-surv'`.
  6. Cross-site isolation: `serveAmendments(centralCtx2, 'lab-b', 0)` → 0 records.
  7. Idempotent re-drain: second `runCycle()` applies 0.

  Use the sibling's `assert`/provision/teardown (drop all DBs in `finally`). Final line: `sync:patient-merge:accept PASSED`. `main().catch(e => { console.error(e); process.exit(1); })`.

  Note: enumeration requires central's target DB to have `patient_id` projected — so the harness must run central's projection (into central's target DB) BEFORE calling the orchestrator. Mirror the projection-drive the S6c harness uses, applied to the central side for enumeration and the lab side for the final assertions.

- [ ] **Step 2: Add the pnpm script** in root `package.json`, next to `sync:order-status:accept`:
```json
"sync:patient-merge:accept": "tsx scripts/sync-patient-merge-live-acceptance.ts",
```

- [ ] **Step 3: Run it** — `pnpm sync:patient-merge:accept` → expect `sync:patient-merge:accept PASSED`. If Postgres/provisioning is unavailable, do NOT fake a pass — report the harness as written + committed with the real run output.

- [ ] **Step 4: Commit**

```bash
git add scripts/sync-patient-merge-live-acceptance.ts package.json
git commit -m "test(sync): S6b patient-merge two-DB live acceptance"
```

---

## Task 7: Docs, gate, and regression

**Files:** `docs/CLI-REFERENCE.md`, `docs/HTTP-API.md`, `docs/OPERATOR-GUIDE.md`

- [ ] **Step 1: Document merge-patient** — extend the existing sync sections (find the S6a/S6c amend entries; add alongside):
  - CLI: `openldr sync merge-patient --survivor <id> --duplicate <id> [--reason]`.
  - HTTP: `POST /api/settings/sync/merge-patient` (lab_admin) — intra-lab patient merge; 400 same-patient / 404 not-found / 409 cross-site.
  - Operator guide: one line on intra-lab MPI merge (survivor kept, duplicate marked `replaced-by`, lab history re-attributed).

- [ ] **Step 2: Per-package gate** (run each directly; never pipe turbo through `tail`). Report counts:
```
pnpm --filter @openldr/db exec vitest run
pnpm --filter @openldr/bootstrap exec vitest run
pnpm --filter @openldr/server exec vitest run
pnpm --filter @openldr/cli exec vitest run
pnpm --filter @openldr/db exec tsc --noEmit
pnpm --filter @openldr/bootstrap exec tsc --noEmit
pnpm --filter @openldr/server exec tsc --noEmit
pnpm --filter @openldr/cli exec tsc --noEmit
```
The full `@openldr/db` vitest run may show Windows parallel-pg-mem TIMEOUT flakes (not real failures) — if so, re-run the relevant files in isolation (`src/fhir-store-merge.test.ts src/relational/patient.test.ts`) and report both results, distinguishing real failures from timeout flakes.

- [ ] **Step 3: Regression** (dev Postgres up):
```
pnpm sync:amend:accept
pnpm sync:order-status:accept
pnpm sync:patient-merge:accept
```
All must print their PASSED line.

- [ ] **Step 4: Commit docs**
```bash
git add docs
git commit -m "docs(sync): document S6b patient-merge usage"
```

---

## Self-Review (completed during planning)

**Spec coverage:** §3 primitive (validate/enumerate-input/cascade/Provenance/outbox/atomic) → Task 1; §4 read-model marker (migration + projectPatient) → Task 2; §5 surface — orchestrator enumerate → Task 3, endpoint → Task 4, CLI → Task 5; §6 transport-unchanged → no task (asserted in Task 6); §7 testing → Tasks 1,2,6; §2 non-goals (cross-lab, demographic absorption, matching) → not implemented, correct.

**Architecture note resolved during planning:** the read model lives in the external DB (`ctx.store.db`), not the internal fhir-store DB — so enumeration is in the bootstrap orchestrator (Task 3), and the primitive (Task 1) takes the enumerated `referencingRefs` as input. This keeps the primitive pure over the internal DB (pg-mem-testable) and honors the spec's "read-model reverse index" decision.

**Type consistency:** `MergeInput`/`MergeResult`/`mergePatients` (Task 1) consumed by the orchestrator (Task 3), endpoint (Task 4), CLI (Task 5), acceptance (Task 6). Errors `PatientNotFoundError`/`CrossSiteMergeError`/`SamePatientError` thrown in Task 1, mapped by name in Tasks 4 (404/409/400) and 5 (friendly fails). The `REF_TABLES` map (Task 3) matches the 4 `patient_id` tables and their FHIR types. `patients.active`/`replaced_by_id` (Task 2) asserted in Task 6.

**Placeholder scan:** Task 4/6 delegate the exact test-harness mocking + the projection-drive call to the sibling idioms (settings-route bootstrap-import mocking; the S6c projection-drive) rather than leaving logic undefined — the behaviors and assertions are fully specified. All other code steps contain complete code. Task 2's migration number is "find the next" (a lookup, not a placeholder — the DDL is complete).
