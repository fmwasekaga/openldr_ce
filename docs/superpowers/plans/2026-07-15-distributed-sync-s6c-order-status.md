# Distributed Sync S6c — Order Status / Metadata Co-edit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the S6a `amend` co-edit machinery to lab orders (`ServiceRequest`) by generalizing the one primitive with a Provenance `activity` parameter + a resource-type allowlist — no new table, endpoint, stream, runner, wiring, or read-model work.

**Architecture:** `FhirStore.amend` already version-bumps any lab-owned resource and the whole transport (`sync_amendments` outbox → `serveAmendments` → amendment pull runner → `applyRemote`) is resource-type-agnostic. S6c adds (1) an optional `activity` param that drives the Provenance activity coding (default `'amend'` reproduces S6a exactly; orders pass `'update'`), and (2) an `AMENDABLE_TYPES` allowlist (`Observation`/`DiagnosticReport`/`ServiceRequest`) that throws `UnsupportedResourceTypeError` for anything else — closing the S6a-deferred gap. The operator surfaces (`POST /api/settings/sync/amend`, `openldr sync amend`) gain one optional param each. A `ServiceRequest` amendment then rides the existing amendment stream and re-projects to `lab_requests.status` for free.

**Tech Stack:** TypeScript, Kysely (+ pg-mem tests), Fastify, Commander (CLI), Vitest, pnpm/turbo monorepo. Spec: `docs/superpowers/specs/2026-07-15-distributed-sync-s6c-order-status-design.md`.

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `packages/db/src/fhir-store.ts` | `activity` param, `AMENDABLE_TYPES` allowlist, `UnsupportedResourceTypeError`, activity-derived Provenance coding | Modify |
| `packages/db/src/fhir-store-amend.test.ts` | Unit tests for activity + allowlist | Modify |
| `apps/server/src/settings-routes.ts` | `activity` passthrough + `UnsupportedResourceTypeError → 400` + audit `activity` | Modify |
| `apps/server/src/settings-sync-routes.test.ts` | Route tests for activity + 400 | Modify |
| `packages/cli/src/sync.ts` | `runSyncAmend` gains `activity` + error mapping | Modify |
| `packages/cli/src/index.ts` | `--activity` option on `sync amend` | Modify |
| `packages/cli/src/sync-amend.test.ts` | CLI test for activity + unsupported-type | Modify |
| `scripts/sync-order-status-live-acceptance.ts` | ServiceRequest round-trip acceptance | Create |
| `package.json` (root) | `sync:order-status:accept` script | Modify |
| `docs/CLI-REFERENCE.md`, `docs/HTTP-API.md`, `docs/OPERATOR-GUIDE.md` | Order-status usage note | Modify |

**Key contract:** `AmendInput` gains `activity?: string` (default `'amend'`). Provenance activity coding = `{ system: 'http://terminology.hl7.org/CodeSystem/v3-DataOperation', code: activity.toUpperCase(), display: activity.toLowerCase() }`. `AMENDABLE_TYPES = new Set(['Observation','DiagnosticReport','ServiceRequest'])`; non-members → `UnsupportedResourceTypeError` (name `'UnsupportedResourceTypeError'`).

---

## Task 1: Generalize the `amend` primitive (activity + allowlist)

**Files:**
- Modify: `packages/db/src/fhir-store.ts`
- Test: `packages/db/src/fhir-store-amend.test.ts`

The `amend` method currently lives at ~`packages/db/src/fhir-store.ts:326`; `AmendInput` at ~line 32; the error classes at ~line 45. Read the current file around those anchors before editing.

- [ ] **Step 1: Write the failing tests** — append to `packages/db/src/fhir-store-amend.test.ts` (it already imports `createFhirStore`, `ResourceNotFoundError`, `NotLabOwnedError` and builds a pg-mem db via `makeMigratedDb()` in a `beforeEach` setting `db`). Add `UnsupportedResourceTypeError` to the import from `./fhir-store`, and add these cases inside the existing `describe('FhirStore.amend', ...)`:

```typescript
  it('amends a ServiceRequest with activity=update: Provenance activity is UPDATE, version bumped, site preserved', async () => {
    const store = createFhirStore(db);
    await store.applyRemote({ resourceType: 'ServiceRequest', id: 'sr-1', version: 1, op: 'upsert', siteId: 'lab-a', resource: { resourceType: 'ServiceRequest', id: 'sr-1', status: 'active' } as any });

    const result = await store.amend({ resourceType: 'ServiceRequest', id: 'sr-1', status: 'completed', activity: 'update', agent: 'central-ops', reason: 'order fulfilled' });

    expect(result.version).toBe(2);
    expect(result.siteId).toBe('lab-a');
    const sr = (await store.get('ServiceRequest', 'sr-1')) as any;
    expect(sr.status).toBe('completed');
    expect(sr.meta.versionId).toBe('2');
    const prov = (await store.get('Provenance', result.provenanceId)) as any;
    expect(prov.activity.coding[0].code).toBe('UPDATE');
    expect(prov.activity.coding[0].display).toBe('update');
  });

  it('defaults activity to AMEND when omitted (S6a regression guard)', async () => {
    const store = createFhirStore(db);
    await store.applyRemote({ resourceType: 'Observation', id: 'obs-def', version: 1, op: 'upsert', siteId: 'lab-a', resource: { resourceType: 'Observation', id: 'obs-def', status: 'preliminary' } as any });
    const result = await store.amend({ resourceType: 'Observation', id: 'obs-def', status: 'amended', agent: 'c' });
    const prov = (await store.get('Provenance', result.provenanceId)) as any;
    expect(prov.activity.coding[0].code).toBe('AMEND');
    expect(prov.activity.coding[0].display).toBe('amend');
  });

  it('rejects a non-allowlisted resource type with UnsupportedResourceTypeError (before any write)', async () => {
    const store = createFhirStore(db);
    // No Patient row exists — the allowlist check must fire regardless (before the not-found check).
    await expect(store.amend({ resourceType: 'Patient', id: 'p-1', status: 'active', agent: 'c' })).rejects.toBeInstanceOf(UnsupportedResourceTypeError);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @openldr/db exec vitest run src/fhir-store-amend.test.ts`
Expected: FAIL — `UnsupportedResourceTypeError` is not exported; the ServiceRequest test fails the allowlist (once added it must pass) / activity assertion fails (still hardcoded AMEND).

- [ ] **Step 3: Add the allowlist const + error class**

In `packages/db/src/fhir-store.ts`, after the `NotLabOwnedError` class (~line 56) add:

```typescript
export class UnsupportedResourceTypeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedResourceTypeError';
  }
}

// Sync S6c: the resource types a central operator may amend/co-edit. Results (Observation /
// DiagnosticReport) + lab orders (ServiceRequest). Anything else is rejected — amend must not inject a
// `status`/version onto an arbitrary lab-owned resource type.
export const AMENDABLE_TYPES: ReadonlySet<string> = new Set(['Observation', 'DiagnosticReport', 'ServiceRequest']);
```

- [ ] **Step 4: Add `activity` to `AmendInput`**

Change the `AmendInput` interface (~line 32) to add, after `reason?`:

```typescript
  activity?: string; // Provenance activity token (Sync S6c). Default 'amend' (result correction);
                     // an order status/metadata change passes 'update'. Mapped to the v3-DataOperation
                     // coding as { code: activity.toUpperCase(), display: activity.toLowerCase() }.
```

- [ ] **Step 5: Wire the allowlist + activity into `amend`**

In the `amend` method (~line 326):

(a) Change the destructure line to include `activity`:
```typescript
      const { resourceType, id, status, patch, agent, reason, activity } = input;
```

(b) Immediately after the destructure (before `const provenanceId = randomUUID();`), add the allowlist guard — this runs BEFORE the transaction, so it fires ahead of the not-found / not-lab-owned checks:
```typescript
      if (!AMENDABLE_TYPES.has(resourceType)) {
        throw new UnsupportedResourceTypeError(`${resourceType} is not amendable (allowed: ${[...AMENDABLE_TYPES].join(', ')})`);
      }
      const activityCode = activity ?? 'amend';
```

(c) Replace the hardcoded Provenance `activity` line (~line 374):
```typescript
          activity: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v3-DataOperation', code: 'AMEND', display: 'amend' }] },
```
with:
```typescript
          activity: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v3-DataOperation', code: activityCode.toUpperCase(), display: activityCode.toLowerCase() }] },
```

Leave everything else in `amend` unchanged (version derivation, site_id resolution, patch sanitization, outbox rows, ordering invariant).

- [ ] **Step 6: Verify the barrel re-exports the new symbols**

`packages/db/src/index.ts` uses `export * from './fhir-store'` (confirmed during S6a), so `UnsupportedResourceTypeError` and `AMENDABLE_TYPES` are auto-exported. Verify this is still the case; if the barrel is explicit, add them.

- [ ] **Step 7: Run tests to verify they pass**

Run: `pnpm --filter @openldr/db exec vitest run src/fhir-store-amend.test.ts`
Expected: PASS (all cases — the 3 new + the S6a cases including the existing happy-path/patch-injection/not-found/not-lab-owned).

- [ ] **Step 8: Typecheck**

Run: `pnpm --filter @openldr/db exec tsc --noEmit`
Expected: clean.

- [ ] **Step 9: Commit**

```bash
git add packages/db/src/fhir-store.ts packages/db/src/fhir-store-amend.test.ts packages/db/src/index.ts
git commit -m "feat(db): amend gains activity param + resource-type allowlist (sync S6c)"
```
(No `Co-Authored-By` trailer.)

---

## Task 2: Endpoint — activity passthrough + `UnsupportedResourceTypeError → 400`

**Files:**
- Modify: `apps/server/src/settings-routes.ts`
- Test: `apps/server/src/settings-sync-routes.test.ts`

The handler is at `apps/server/src/settings-routes.ts:72` (`POST /api/settings/sync/amend`). Read it first.

- [ ] **Step 1: Write the failing tests** — in `apps/server/src/settings-sync-routes.test.ts` (the S6a amend describe block uses a `fhirStore: { amend: vi.fn(...) }` on the fake ctx). Add:

```typescript
  it('passes activity through to fhirStore.amend and returns 200', async () => {
    const amend = vi.fn(async () => ({ version: 2, provenanceId: 'prov-1', siteId: 'lab-a' }));
    const app = buildSettingsApp({ fhirStore: { amend } }); // use the harness's actual app builder
    const res = await app.inject({ method: 'POST', url: '/api/settings/sync/amend', payload: { resourceType: 'ServiceRequest', id: 'sr-1', status: 'completed', activity: 'update' } });
    expect(res.statusCode).toBe(200);
    expect(amend).toHaveBeenCalledWith(expect.objectContaining({ resourceType: 'ServiceRequest', id: 'sr-1', status: 'completed', activity: 'update' }));
  });

  it('maps UnsupportedResourceTypeError to 400', async () => {
    const app = buildSettingsApp({ fhirStore: { amend: async () => { const e = new Error('no'); e.name = 'UnsupportedResourceTypeError'; throw e; } } });
    const res = await app.inject({ method: 'POST', url: '/api/settings/sync/amend', payload: { resourceType: 'Patient', id: 'p-1', status: 'active' } });
    expect(res.statusCode).toBe(400);
  });
```

Match the exact app-builder/fake-ctx idiom the existing S6a amend tests use (they were added in the same file — copy their `buildSettingsApp`/fake-ctx shape verbatim; the names above are illustrative).

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @openldr/server exec vitest run src/settings-sync-routes.test.ts`
Expected: FAIL — `activity` not passed (amend called without it); `UnsupportedResourceTypeError` falls through to 500 (rethrown).

- [ ] **Step 3: Implement**

In the handler at `settings-routes.ts:72`:

(a) Add `activity` to the destructured body type (line 73):
```typescript
    const b = (req.body ?? {}) as { resourceType?: unknown; id?: unknown; status?: unknown; reason?: unknown; patch?: unknown; agent?: unknown; activity?: unknown };
```

(b) Pass `activity` into the `amend` call (in the object at lines 79-86), after `agent`:
```typescript
        activity: typeof b.activity === 'string' && b.activity ? b.activity : undefined,
```

(c) Add `activity` to the audit metadata (line 91):
```typescript
        metadata: { version: result.version, provenanceId: result.provenanceId, siteId: result.siteId, activity: typeof b.activity === 'string' ? b.activity : 'amend' },
```

(d) Add the error mapping in the catch (after the `NotLabOwnedError` line, ~line 97):
```typescript
      if (name === 'UnsupportedResourceTypeError') { reply.code(400).send({ error: 'resource type is not amendable' }); return; }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @openldr/server exec vitest run src/settings-sync-routes.test.ts`
Expected: PASS (new + all pre-existing).

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @openldr/server exec tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/settings-routes.ts apps/server/src/settings-sync-routes.test.ts
git commit -m "feat(server): amend endpoint accepts activity + maps unsupported type to 400 (sync S6c)"
```

---

## Task 3: CLI — `--activity` + unsupported-type mapping

**Files:**
- Modify: `packages/cli/src/sync.ts`
- Modify: `packages/cli/src/index.ts`
- Test: `packages/cli/src/sync-amend.test.ts`

`runSyncAmend` is in `packages/cli/src/sync.ts` (added in S6a, after `runSyncRevoke`); the command is registered in `packages/cli/src/index.ts` under `syncGroup.command('amend')`. Read both first.

- [ ] **Step 1: Write the failing tests** — in `packages/cli/src/sync-amend.test.ts` (it mocks `@openldr/bootstrap`'s `createAppContext` to return `{ fhirStore: { amend }, close }` via `vi.hoisted()` — reuse that exact idiom). Add:

```typescript
  it('passes --activity through to amend', async () => {
    const code = await runSyncAmend({ resourceType: 'ServiceRequest', id: 'sr-1', status: 'completed', activity: 'update', json: true });
    expect(code).toBe(0);
    expect(amend).toHaveBeenCalledWith(expect.objectContaining({ resourceType: 'ServiceRequest', id: 'sr-1', status: 'completed', activity: 'update' }));
  });

  it('maps UnsupportedResourceTypeError to a non-zero exit', async () => {
    amend.mockRejectedValueOnce(Object.assign(new Error('no'), { name: 'UnsupportedResourceTypeError' }));
    const code = await runSyncAmend({ resourceType: 'Patient', id: 'p-1', status: 'active', json: true });
    expect(code).toBe(1);
  });
```

Match the file's existing `amend` mock accessor (it's the hoisted `vi.fn` the S6a test already declares).

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @openldr/cli exec vitest run src/sync-amend.test.ts`
Expected: FAIL — `activity` not forwarded; `UnsupportedResourceTypeError` hits the default branch (still returns 1 via `redactError`, so that case may already pass — the activity-passthrough case is the load-bearing failure).

- [ ] **Step 3: Implement in `runSyncAmend`** (`packages/cli/src/sync.ts`)

(a) Add `activity?: string` to the `opts` param type.

(b) Add `activity: opts.activity` to the object passed to `ctx.fhirStore.amend(...)`.

(c) Add a `case` to the error `switch` (alongside `ResourceNotFoundError`/`NotLabOwnedError`):
```typescript
      case 'UnsupportedResourceTypeError':
        return fail(json, 'only Observation, DiagnosticReport, ServiceRequest can be amended');
```

- [ ] **Step 4: Register the `--activity` option** in `packages/cli/src/index.ts`

In the `syncGroup.command('amend')` chain, add after the `--reason`/`--patch` options and before `--json`:
```typescript
  .option('--activity <token>', "Provenance activity token: 'amend' (default) or 'update' for order status", 'amend')
```
Commander passes it as `opts.activity`, matching `runSyncAmend`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @openldr/cli exec vitest run src/sync-amend.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @openldr/cli exec tsc --noEmit`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add packages/cli/src/sync.ts packages/cli/src/index.ts packages/cli/src/sync-amend.test.ts
git commit -m "feat(cli): openldr sync amend --activity + unsupported-type mapping (sync S6c)"
```

---

## Task 4: ServiceRequest round-trip live acceptance

**Files:**
- Create: `scripts/sync-order-status-live-acceptance.ts`
- Modify: `package.json` (root) — add `sync:order-status:accept`

Model this EXACTLY on `scripts/sync-amend-live-acceptance.ts` (the S6a harness — two internal Postgres DBs, in-process serve/apply, no HTTP). Read that sibling fully and copy its connect/migrate/teardown/`assert` header verbatim. Dev Postgres must be up (`docker compose up -d postgres`).

- [ ] **Step 1: Write the acceptance script** `scripts/sync-order-status-live-acceptance.ts`:

```typescript
// Sync S6c end-to-end: a lab authors a ServiceRequest (order), central changes its status via the
// generalized amend (activity=update), and the owning lab pulls it down and converges — including the
// lab_requests read-model projection. Two Postgres DBs (central + lab), in-process serve/apply (HTTP
// auth/site-scoping is unit-proven in S6a). Mirrors scripts/sync-amend-live-acceptance.ts's setup.
import { createFhirStore } from '@openldr/db';
import { serveAmendments } from '@openldr/bootstrap';
import { createAmendmentPullRunner } from '@openldr/sync';
// Copy the two-DB connect/migrate/provision + assert helpers from sync-amend-live-acceptance.ts verbatim.

async function main(): Promise<void> {
  // connect + migrate two internal DBs: central + lab (per the sibling)
  const SITE = 'lab-a';
  const centralStore = createFhirStore(central);
  const labStore = createFhirStore(lab);

  // 1. Lab authors a ServiceRequest (order) status 'active'; mirror it to central + the lab's own DB.
  const sr = { resourceType: 'ServiceRequest', id: 'sr-ord-1', status: 'active', intent: 'order' };
  await labStore.applyRemote({ resourceType: 'ServiceRequest', id: sr.id, version: 1, op: 'upsert', siteId: SITE, resource: sr as any });
  await centralStore.applyRemote({ resourceType: 'ServiceRequest', id: sr.id, version: 1, op: 'upsert', siteId: SITE, resource: sr as any });

  // 2. Central updates the order status via the generalized amend.
  const updated = await centralStore.amend({ resourceType: 'ServiceRequest', id: sr.id, status: 'completed', activity: 'update', agent: 'central-ops', reason: 'fulfilled' });
  assert(updated.version === 2, 'order amend version is 2');
  assert(updated.siteId === SITE, 'amend preserves owning site');

  // 3. Lab drains its amendment stream in-process.
  const ctxCentral: any = { internalDb: central, logger: console };
  let cursor = 0;
  const runner = createAmendmentPullRunner({
    getToken: async () => 'x',
    postPull: async ({ fromSeq }) => serveAmendments(ctxCentral, SITE, fromSeq),
    applyRecord: (rec) => labStore.applyRemote(rec),
    readCursor: async () => cursor,
    advanceCursor: async (s) => { cursor = s; },
    logger: console as any,
  });
  const applied = await runner.runCycle();
  assert(applied === 2, `applied 2 records (got ${applied})`);

  // 4. Lab convergence: resource + Provenance activity + read-model projection.
  const labSr = (await labStore.get('ServiceRequest', sr.id)) as any;
  assert(labSr.status === 'completed', 'lab order is now completed');
  assert(labSr.meta.versionId === '2', 'lab order is at version 2');
  const prov = (await labStore.get('Provenance', updated.provenanceId)) as any;
  assert(prov.activity.coding[0].code === 'UPDATE', 'Provenance activity is UPDATE');
  // Read-model: the lab's projection worker is not running in this harness, so drive the projection the
  // same way the sibling harnesses assert read-model state — either run one projection cycle if the
  // sibling does, OR assert lab_requests reflects status after invoking the same projection path the
  // sibling uses. Follow sync-amend-live-acceptance.ts / projection-live-acceptance.ts for the exact
  // projection-drive call; then:
  //   const row = await lab.selectFrom('lab_requests').select('status').where('id','=',sr.id).executeTakeFirst();
  //   assert(row?.status === 'completed', 'lab_requests.status projected to completed');

  // 5. Cross-site isolation.
  const other = await serveAmendments(ctxCentral, 'lab-b', 0);
  assert(other.records.length === 0, 'a different site sees no amendments');

  // 6. Idempotent re-drain.
  const again = await runner.runCycle();
  assert(again === 0, 'idempotent re-drain applies nothing');

  console.log('sync:order-status:accept PASSED');
  await central.destroy();
  await lab.destroy();
}
main().catch((e) => { console.error(e); process.exit(1); });
```

**Read-model assertion note:** the two-DB harnesses apply changes via `applyRemote` but do not necessarily run the async projection worker. Before writing the `lab_requests.status` assertion, check how `sync-amend-live-acceptance.ts` (and `scripts/projection-live-acceptance.ts`) drive/await the projection — reuse that exact mechanism to project the lab's `change_log` into `lab_requests`, then assert `status === 'completed'`. If driving the projection in-harness is non-trivial, at minimum assert the canonical `ServiceRequest` converged (steps 4a-c) and note the read-model projection is covered by the existing projection acceptance — do NOT fake the read-model assertion.

- [ ] **Step 2: Add the pnpm script** — in root `package.json` `scripts`, next to `sync:amend:accept`:
```json
"sync:order-status:accept": "tsx scripts/sync-order-status-live-acceptance.ts",
```
(Match the exact runner `sync:amend:accept` uses.)

- [ ] **Step 3: Run it** — `docker compose up -d postgres` if needed, then `pnpm sync:order-status:accept`. Expected final line: `sync:order-status:accept PASSED`. If Postgres/provisioning is unavailable, DO NOT fake a pass — report the harness as written + committed with the real run output for the controller to run live.

- [ ] **Step 4: Commit**

```bash
git add scripts/sync-order-status-live-acceptance.ts package.json
git commit -m "test(sync): S6c ServiceRequest order-status two-DB live acceptance"
```

---

## Task 5: Docs, gate, and regression

**Files:**
- Modify: `docs/CLI-REFERENCE.md`, `docs/HTTP-API.md`, `docs/OPERATOR-GUIDE.md`

- [ ] **Step 1: Document the order-status usage**

The S6a surfaces are already documented in these three files (added in S6a Task 11). Extend those entries minimally:
- `docs/CLI-REFERENCE.md` — note the `--activity` flag on `openldr sync amend` and the ServiceRequest/order example (`--resource-type ServiceRequest --status completed --activity update`).
- `docs/HTTP-API.md` — note `POST /api/settings/sync/amend` accepts an optional `activity` and that it amends Observation/DiagnosticReport/ServiceRequest (others → 400).
- `docs/OPERATOR-GUIDE.md` — one line that order status/metadata co-edit uses the same amend surface with `activity: update`.

Match each doc's existing structure. Keep it concise.

- [ ] **Step 2: Full per-package gate** (run each directly; never pipe turbo through `tail`)

```
pnpm --filter @openldr/db exec vitest run
pnpm --filter @openldr/server exec vitest run
pnpm --filter @openldr/cli exec vitest run
pnpm --filter @openldr/db exec tsc --noEmit
pnpm --filter @openldr/server exec tsc --noEmit
pnpm --filter @openldr/cli exec tsc --noEmit
```
All green. Report actual counts. (bootstrap/sync are untouched by S6c but run `pnpm --filter @openldr/bootstrap exec vitest run` + `@openldr/sync` too as a cheap safety check.) Re-run any single-package flake directly.

- [ ] **Step 3: Regression — the S6a amendment path is unaffected**

```
pnpm sync:amend:accept
pnpm sync:order-status:accept
```
Both must print their `PASSED` line. (`sync:amend:accept` re-passing proves the default-`activity` path preserved S6a exactly.) Optionally re-run `pnpm sync:accept` / `sync:pull:accept` / `sync:terminology:accept` if Postgres is up.

- [ ] **Step 4: Commit doc changes**

```bash
git add docs
git commit -m "docs(sync): document S6c order-status amend usage"
```

---

## Self-Review (completed during planning)

**Spec coverage:** §3.1 activity param → Task 1 (steps 4-5). §3.2 allowlist + `UnsupportedResourceTypeError` → Task 1 (step 3, 5b). §3.3 everything-else-untouched → Task 1 (leaves version/site/patch/outbox as-is). §4.1 endpoint activity + 400 + audit → Task 2. §4.2 CLI `--activity` + error → Task 3. §5 transport/read-model unchanged → no task (correct; asserted in Task 4). §6 testing → Tasks 1-4. §2 non-goals (cross-site re-assignment, status-vocab validation) → not implemented, correct.

**Type consistency:** `AmendInput.activity?: string` (Task 1) is read by the endpoint (Task 2) and CLI (Task 3). `UnsupportedResourceTypeError` (name `'UnsupportedResourceTypeError'`) is thrown in Task 1 and mapped by name in Tasks 2 (→400) and 3 (→friendly fail). `AMENDABLE_TYPES` membership is `Observation`/`DiagnosticReport`/`ServiceRequest` consistently. `activity`-derived coding `{code: UPPER, display: lower}` asserted in Task 1 and Task 4.

**Placeholder scan:** the Task 4 read-model assertion carries an explicit "follow the sibling's projection-drive mechanism; do not fake it" instruction rather than undefined logic — the round-trip assertions (steps 1-6) are fully specified; only the projection-drive call is delegated to the existing sibling idiom. All other code steps contain complete code.
