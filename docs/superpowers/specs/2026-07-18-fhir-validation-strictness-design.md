# FHIR Validation Strictness — Design

**Date:** 2026-07-18
**Status:** design, approved for spec review

## Problem

OpenLDR's FHIR validator (`packages/fhir/src/validate.ts`, `validateResource`) is a
**single-resource structural validator**: it confirms the payload is a supported `resourceType`
and passes that type's Zod schema. It has no cross-resource or clinical-integrity rules. So a
standalone laboratory `Observation` with no linked `ServiceRequest` — a lab **result** with no
**order** — is structurally valid FHIR and persists silently. For lab data that is a real
data-quality gap.

We want a **configurable strictness** with a small, extensible **rules framework**, defaulting to
the strictest level, so operators can gate incomplete clinical data — while never wrongly
rejecting non-lab or documentation data.

### The form-type nuance (why per-resource, category-keyed)

Every form emits a `QuestionnaireResponse`; **test-based** forms *additionally* extract clinical
resources (`Patient`, `ServiceRequest`, `Observation`, `DiagnosticReport`); a single form can emit
**both** documentation and lab request/result. Rules therefore key on **each resource's own FHIR
`category`**, not on the form. A `QuestionnaireResponse` is never an `Observation`, so it is exempt
by construction; a vitals/survey `Observation` (non-`laboratory` category) is exempt by its own
category; only a `laboratory` `Observation` / `LAB` `DiagnosticReport` is subject to rule #1.

## Goals

- A **rule registry** so clinical rules can be added over time; **request↔result is rule #1**.
- Three levels — **low / medium / high**, **default high** — that switch which rules run and how
  deep rule #1 looks.
- Gate the **front door** (CLI ingest, HTTP webhook Persist Store node, form responses — all via
  `persistResources`) with **atomic** batch validation and a consolidated `OperationOutcome`.
- **Exempt distributed sync** (`/api/sync/push` → `applyRemote`) entirely.
- Operator control in the **Danger Zone** behind a **type-to-confirm** dialog, with **CLI parity**
  and an **audit** record on every change.

## Non-goals

- Full FHIR profile/StructureDefinition validation, terminology-binding validation, or a general
  constraint engine. Rule #1 only; the framework is the extensibility point for later rules.
- Re-validating already-stored data, or validating on the sync/replication path.
- Changing structural validation (`validateResource` stays as-is and always runs).

## Design

### 1. Rules framework (`@openldr/fhir`)

New: `packages/fhir/src/rules/` + `packages/fhir/src/validate-batch.ts`.

```ts
export type StrictnessLevel = 'low' | 'medium' | 'high';
const LEVEL_RANK = { low: 0, medium: 1, high: 2 };

export interface RuleContext {
  level: StrictnessLevel;
  batch: FhirResource[];                       // the resources being persisted together
  resolveServiceRequest(id: string): Promise<boolean>; // store lookup (injected)
}

export interface ClinicalRule {
  id: string;                                  // e.g. 'result-requires-request'
  description: string;
  minLevel: StrictnessLevel;                   // the lowest level at which the rule runs
  appliesTo(resource: FhirResource): boolean;
  check(resource: FhirResource, ctx: RuleContext): Promise<Issue[]> | Issue[];
}

export const CLINICAL_RULES: ClinicalRule[] = [resultRequiresRequest];

// Runs structural validateResource on every resource (always), then every rule whose
// minLevel <= level and whose appliesTo matches. Aggregates all issues into ONE OperationOutcome.
// `batch` in RuleContext is the validated resource set, built internally from `resources`.
export async function validateBatch(
  resources: unknown[],
  opts: { level: StrictnessLevel; resolveServiceRequest(id: string): Promise<boolean> },
): Promise<{ ok: true; resources: FhirResource[] } | { ok: false; outcome: OperationOutcome }>;
```

Issues use the existing `operation-outcome.ts` helpers (`outcomeFromIssues`). `low` runs zero
clinical rules → behaviour identical to today (structural only).

### 2. Rule #1 — `result-requires-request` (`minLevel: 'medium'`)

- **`appliesTo`**: `Observation` whose `category[].coding[]` contains code `laboratory`
  (system `http://terminology.hl7.org/CodeSystem/observation-category`, tolerant of system), **or**
  `DiagnosticReport` whose `category[].coding[]` contains code `LAB`
  (system `http://terminology.hl7.org/CodeSystem/v2-0074`).
- **`check`**:
  - **medium** — `basedOn` must be non-empty and reference a `ServiceRequest`
    (`reference` starts with `ServiceRequest/` or a matching `type`). Otherwise: one issue,
    `severity: error`, `code: required`, `expression: [<resource>.basedOn]`.
  - **high** — additionally, that `ServiceRequest` reference must **resolve**: present as a
    `ServiceRequest` in `ctx.batch`, or `ctx.resolveServiceRequest(id)` returns true. A dangling
    reference → one issue, `code: not-found`.
  - **low** — rule does not run (below `minLevel`).

Level→behaviour summary: **low** structural only · **medium** `basedOn` present · **high**
`basedOn` resolves.

### 3. Where it runs — `persistResources`

`packages/db/src/persist.ts` is the single shared front door (`persistResource` /
`persistResources`), used by both `createIngestContext` and the workflow `persistStore` service
(bootstrap `workflowPersist`, comment: *"same wiring as ingest-context"*), and by form responses.

Change: `persistResources(deps, resources, provenance, opts?)` where
`opts = { level: StrictnessLevel; resolveServiceRequest(id): Promise<boolean> }`.

1. Run `validateBatch(resources, { level, resolveServiceRequest })` **first**.
2. On `!ok`: `throw new AppError('VA0002', { details: { outcome } })` — **nothing is saved** (the
   validation pass precedes all `fhirStore.save` calls, so it is naturally atomic; the current
   mid-loop-throw partial-save wart is removed by validating up-front).
3. On `ok`: save each resource as today (structural validity already guaranteed by `validateBatch`).

`persistResource` (single) delegates to a one-element `persistResources`.

`deps` for the resolver: bootstrap injects
`resolveServiceRequest = (id) => fhirStore.exists('ServiceRequest', id)`. Add a cheap
`exists(resourceType, id): Promise<boolean>` to `FhirStore` (a `select 1 … limit 1` guard;
`get()` would also work but loads the row). In-batch `ServiceRequest`s are checked before the
store call.

**Sync push is untouched:** `apps/server/src/sync-routes.ts` continues to call
`ctx.fhirStore.applyRemote(rec)` directly — no `validateBatch`.

### 4. Configuration

- New app-setting key **`validation.strictness`** ∈ `{low, medium, high}`, **default `high`**,
  stored via the existing `createAppSettingsStore` (generic `get(key)` / `set(key, value, by)`).
- A typed accessor `createValidationSettings(store)` → `{ get(): Promise<StrictnessLevel>;
  set(level, updatedBy): Promise<void> }`, mirroring `createNumberSettings`. Bootstrap reads the
  level per persist call (a single indexed `app_settings` read; add the same small in-process
  cache + invalidate-on-set that number-settings uses if profiling warrants).
- **API:** `GET /api/settings/validation` → `{ strictness }`; `PUT /api/settings/validation`
  `{ strictness }` — both `requireRole('lab_admin')`, in `settings-routes.ts`. The PUT records an
  audit event `settings.validation_strictness` (before/after).

### 5. UI — Danger Zone, type-to-confirm

In `apps/studio/src/pages/settings/General.tsx`, add a **"Data validation"** row inside the
existing **Danger Zone** card (admin-only). It is *located* in the Danger Zone but is backed by the
settings PUT above, **not** the one-shot `/api/settings/danger/:action` mechanism.

- Shows the current level; a **Change** control opens a **type-to-confirm dialog** (a new reusable
  `TypeToConfirmDialog`, GitHub-style): it names the target level and its consequence and requires
  the operator to **type the target level word** (`low` / `medium` / `high`) to enable **Apply**.
- Below-`high` renders with a warning treatment so a reduced level is visibly consequential.
- Every change is audited (server-side, above). i18n strings added to `en/fr/pt` (parity test).

### 6. CLI parity

`openldr settings validation show` and `openldr settings validation set <level>` in
`packages/cli/src/index.ts` (settings group), delegating to the shared bootstrap accessor so the
CLI and UI share one code path (per the CLI-operator-parity convention).

### 7. Error code

Add a **`VA` (validation)** domain to `packages/core/src/error-catalog.ts`:
- `VA0002` — *"clinical validation failed"*, `httpStatus: 422`, domain `validation`. The thrown
  `AppError` carries the aggregated `OperationOutcome` in `details.outcome`; the central Fastify
  error handler serialises code + the `OperationOutcome` body (422). (Structural failures may keep
  their current path or move to `VA0001`; decided in the plan.)

## Data flow

```
POST bundle → webhook workflow Persist Store ─┐
openldr ingest <file> → converter ────────────┼─→ persistResources(resources, {level, resolveSR})
POST /api/forms/:id/responses → extract ──────┘         │
                                                        ├─ validateBatch: structural + rules≤level
                                                        │     └ fail → throw AppError VA0002 (422 + OperationOutcome); NOTHING saved
                                                        └─ ok → fhirStore.save each (as today)

POST /api/sync/push → applyRemote  (NO validateBatch — exempt)
```

## Testing

- **Unit (`@openldr/fhir`)**: rule #1 `appliesTo` (lab `Observation`, `LAB` `DiagnosticReport` in;
  vitals/survey `Observation`, `QuestionnaireResponse`, `Patient` out); `check` at each level
  (missing `basedOn`; present but dangling; resolvable in-batch; resolvable in-store via a stub
  resolver). `validateBatch` aggregates multiple issues into one `OperationOutcome`; `low` runs no
  rules.
- **Integration (`@openldr/db`/bootstrap)**: `persistResources` at high rejects atomically (0 rows
  written) with `VA0002` + `OperationOutcome`; medium rejects missing `basedOn` but allows a
  resolvable one; low persists anything structurally valid; `applyRemote` path unaffected.
- **Settings/CLI**: `validation.strictness` get/set round-trips + audit; CLI `settings validation`
  parity; default is `high` on a fresh DB.
- **Live acceptance** (`scripts/*-live-acceptance.ts` style): POST a lab Bundle missing the order →
  422 `OperationOutcome`; add the `ServiceRequest` (same Bundle) → success.

## Rollout risks / considerations

- **Default `high` changes front-door behaviour.** New ingests of a lab `Observation`/`LAB`
  `DiagnosticReport` without a resolvable `ServiceRequest` will now be **rejected**. This is the
  intended effect, but the implementation plan MUST verify the repo's own fixtures still pass at
  high — especially the WHONET sample ingest (`samples/whonet-sample.sqlite` via
  `pnpm docs:seed` / `e2e:seed`) and any e2e/docs-screenshot data. If those produce lab results
  without linked `ServiceRequest`s, either the fixtures are completed (add the orders) or the
  seed/e2e harness sets `validation.strictness` explicitly. Resolve before flipping the default.
- **Category coverage.** A lab result that omits `category` entirely won't match `appliesTo` and
  escapes rule #1. Documented as a known limitation of rule #1; a future rule could infer lab-ness
  from `code` (LOINC) if needed.
- **Batch scope for "resolve".** "High" resolves against the current batch ∪ store only. A result
  and its order pushed in *separate* front-door batches must arrive order first (or same batch).
  Acceptable given atomic-batch semantics; called out for integrators.

## Open questions (for plan, non-blocking)

- Reuse `FM0001`/add `VA0001` for the structural-failure code, or leave structural on its current
  path? (Plan decides; user-facing behaviour is unchanged either way.)
- Whether `openldr fhir validate <file>` gains an optional `--level` to preview rule outcomes
  offline (nice-to-have, not required).
