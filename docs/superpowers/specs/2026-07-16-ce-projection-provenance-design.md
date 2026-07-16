# CE projection provenance — Design

**Date:** 2026-07-16
**Status:** design approved, not implemented
**Repo:** `openldr_ce`
**Slice:** B of 3 (CE read-model). **Fully independent** — no dependency on Slice A or C, either order.

## The bug

**Every projected row in every external table has `source_system`, `plugin_id`, `plugin_version`
and `batch_id` NULL — for every producer, always.** The data is persisted correctly on the
canonical resource; the projection simply never reads it back.

`packages/db/src/projection/cycle.ts:27-31` (`applyProjection`):

```ts
const canonical = await deps.fhirStore.get(task.resourceType, task.id);
if (canonical) {
  await deps.relationalWriter.write(canonical);   // ← no provenance argument
} else {
  await deps.relationalWriter.deleteById(task.resourceType, task.id);
}
```

`packages/db/src/relational-writer.ts:26` — `async write(resource, provenance = {})` — **silently
defaults to empty**. And `packages/db/src/fhir-store.ts:271-279` selects **only the `resource`
column**, so the provenance is never fetched at all.

`provColumns` (`packages/db/src/relational/extract.ts:5-17`) maps `Provenance` → the four columns
correctly. Nothing is wrong with it. Nothing passes it anything.

## Proof (live, 2026-07-16)

```
fhir.fhir_resources  →  source_system='cdr', batch_id=8aa3e7ae-9c81-4c8e-a357-e797d159b1c4   ✓
public.lab_requests  →  source_system=NULL, plugin_id=NULL, plugin_version=NULL, batch_id=NULL  ✗
```

The canonical store has all four columns and they are populated — `fhir-store.ts:239` spreads
`...prov` on insert.

## Why it matters

It **silently defeats the `batchId` design** that `persist-store-service.ts:11-17` implements
deliberately: *"a per-run batchId is stamped into the provenance of every row … so an outbound
workflow can query exactly this run's rows."* That query returns nothing — `batch_id` is NULL in
every projected row. Likewise `source_system`: the read model cannot say which producer wrote what.

`activity-service.ts:13` reads batches by `batchId`. Any consumer relying on projected provenance
is reading NULLs today.

## Constraints discovered (verified — build on these)

1. **`fhirStore.get` has a second caller.** `packages/db/src/terminology-store.ts:161`
   (`return fhirStore.get(sys.kind, sys.resource_id)`) expects a bare `FhirResource`. **Changing
   `get`'s return type breaks terminology.** The change must be additive.
2. **`change_log` does not carry provenance.** `fhir-store.ts:185` writes only
   `{resource_type, id, version, op, content_hash, site_id}`. So the projection cannot obtain it
   from the rows it already fetches — it must read the canonical row.
3. **`applyProjection` is the only production caller of `relationalWriter.write`.** Every other
   `.write(` in the repo is XLSX or stdout. Making provenance required is therefore contained.
4. **Projection is asynchronous (R2)** — `persist` returns `flattened: 'deferred'` and the worker
   tails `change_log` out of band. This is the only path that projects.
5. **`cycle.test.ts` has no provenance assertions at all**, and `cycle.test.ts:39` calls
   `relationalWriter.write({resourceType:'Patient', id:'p1'})` with no provenance — the test
   demonstrates the very default that hid the bug.

## Design

### 1. `FhirStore.getWithProvenance` (additive)

```ts
getWithProvenance(resourceType: string, id: string):
  Promise<{ resource: FhirResource; provenance: Provenance } | null>;
```

Selects `resource` **plus** `source_system`, `plugin_id`, `plugin_version`, `batch_id` from
`fhir.fhir_resources` and maps them into a `Provenance`. `get` is left exactly as-is so
`terminology-store.ts:161` is untouched.

Additive rather than a signature change: one caller needs provenance, one does not, and breaking
the one that doesn't buys nothing.

### 2. `applyProjection` passes it through

```ts
const found = await deps.fhirStore.getWithProvenance(task.resourceType, task.id);
if (found) {
  await deps.relationalWriter.write(found.resource, found.provenance);
} else {
  await deps.relationalWriter.deleteById(task.resourceType, task.id);
}
```

### 3. Provenance becomes REQUIRED (the anti-recurrence measure)

```ts
write(resource: unknown, provenance: Provenance): Promise<WriteResult>;
export interface RelationalWriteItem { resource: unknown; provenance: Provenance; }
```

Drop the `= {}` default and the `?`. **The default is what let this hide** — a silent empty is
indistinguishable from a deliberate one. With provenance required, a caller that forgets is a type
error rather than four NULL columns nobody notices for months.

Cheap because of constraint 3: one production caller, plus tests. A caller with genuinely no
provenance passes `{}` **explicitly**, which is a visible decision rather than an accident.

### 4. Fix `writeMany` the same way

`writeMany` takes `RelationalWriteItem[]` with an optional `provenance` and defaults it at
`relational-writer.ts:36` (`it.provenance ?? {}`). Same treatment: required field, drop the `??`.
It has no production callers today, but leaving one optional and the other required is exactly how
the next instance of this bug gets in.

## Error handling

No new failure modes. `getWithProvenance` returns `null` for a missing row, identically to `get`,
and `applyProjection`'s existing `else` branch (delete) handles it. A row with all-NULL provenance
columns yields `{}` — correct, and now distinguishable from "nobody passed anything", because the
type system forbids the latter.

`applyProjection` failures are already caught and logged per-task by `runCycle`
(`cycle.ts:41-46`), and `reprojectAll` can heal — unchanged.

## Testing

- **The regression test that should have existed**: project a resource whose canonical row carries
  `source_system` + `batch_id`, assert the projected row carries both. `cycle.test.ts` currently
  asserts nothing about provenance — that gap is why this shipped.
- **Required-provenance is a compile-time assertion**: `pnpm typecheck` failing on a `write()`
  without provenance *is* the test. Update `cycle.test.ts:39` and friends to pass `{}` explicitly.
- **`getWithProvenance` returns `{}`** for a row with NULL provenance columns (not `undefined`,
  not a throw).
- **`get` is unchanged** — `terminology-store.ts:161` still compiles and its tests still pass.
- **CORRECTION 2026-07-16:** an earlier draft of this section claimed "the unit tests cannot see the
  real `fhir_resources` columns" and that only a live run could prove the chain. **That is wrong.**
  `makeMigratedDb()` (`packages/db/src/migrations/internal/test-helpers.ts`) runs **every real
  internal migration** against pg-mem, and `makeMigratedExternalDb()` does the same for the external
  schema — so `fhir.fhir_resources` genuinely has the provenance columns under test. The full chain
  (**save with provenance → runCycle → assert the projected row carries it**) is an ordinary unit
  test in `cycle.test.ts`. Write it there.
- **Note the runner:** `packages/db` uses **vitest** (`vitest run --testTimeout 15000`), with
  `describe`/`it`/`expect`. This is **not** cdr-toolchain's `node:test` — different repo, different
  convention.
- **Live verification** (corroboration, not the proof): re-ingest one CDR lab (runbook in
  `2026-07-16-cdr-fhir-ingest-to-ce-design.md`) and confirm `public.lab_requests.source_system =
  'cdr'` with `batch_id` matching `fhir.fhir_resources.batch_id` for the same id.
- Gate: `pnpm turbo run typecheck test --force`.

## Explicitly out of scope

- **RUNNING a backfill.** Every row projected before this fix keeps NULL provenance until
  re-projected. Executing `reprojectAll` against a populated store is an operational decision with a
  real cost — not this slice's call.

  ⚠ **AMENDED 2026-07-16 — the original justification here was FALSE.** This section previously read
  *"`reprojectAll` exists and would heal them"*. It would not: `reprojectAll` (`cycle.ts:76`) selects
  **only the `resource` column**, exactly as `get` did — so a full rebuild writes NULL provenance for
  every row. **The identical bug, one function below the one this slice fixes.** Found during
  implementation, when making `provenance` required broke its `writeMany` call.

  Consequence of fixing only the deferred path: **nothing could ever populate provenance on an
  existing row.** New writes carry it, old rows keep NULLs forever, and the repair tool silently
  repairs nothing. That is a worse state than either finishing or not starting, so **fixing
  `reprojectAll` is IN scope** (approved 2026-07-16): its SELECT gains the four provenance columns
  and carries them through `writeMany`. **Running** it remains out of scope.
- Slice A (classifier) and Slice C (organism semantics).
- The AST fan-out bug and the unfiltered `ast` window (`report-seeds.ts:648-662`, known).

## Risk

Low. One additive method, one call site, and a type change with one production caller. The blast
radius is the projection path, which is asynchronous and already failure-tolerant.

The honest risk is the opposite one: **this fix changes nothing visible until rows are re-projected**.
Already-projected rows keep their NULLs until `reprojectAll` runs (out of scope, above), so an
operator checking the read model after deploying this will still see NULLs on old rows and may
reasonably conclude it didn't work.
