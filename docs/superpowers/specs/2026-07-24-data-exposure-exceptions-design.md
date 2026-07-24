# Data Exposure (Settings → Data Exposure) — Design

**Date:** 2026-07-24
**Status:** Approved (design), pending spec review
**Area:** `@openldr/dashboards`, `apps/server`, `apps/studio`, `@openldr/rbac`, `@openldr/cli`, `@openldr/bootstrap`

## Problem

The dashboard widget builder decides which table columns a user may expose (as
grouped dimensions or ad-hoc join output). Today that policy is a **hardcoded
denylist** in two structures in `packages/dashboards/src/models/registry.ts`:

- `JOINABLE_TABLES[].denyColumns` — the global universe of user-defined ("arbitrary") joins.
- `MODELS[].joins[].denyColumns` — per-model curated optional joins.

Both answer the same underlying question — *which columns of table X may be
exposed through analytics* — but they live in code, duplicated, and can only be
changed with a code deploy. Operators want to adjust the policy at runtime from a
Settings page.

## Goals

- **Runtime editability.** Admins change which columns are hidden/exposed live, no deploy.
- **Single source of truth.** One per-table column policy that governs *both* the
  arbitrary-join universe and the per-model optional joins — and any other surface
  that reads exposable columns (Query page, Report builder) via the same functions.
- **Exposed-by-default (deny-list) model.** A column not named in the policy is
  exposed. New schema columns appear automatically. "Exceptions" = the hidden ones.
- **Fail-safe on absence.** If the policy store is empty/unreadable, fall back to the
  hardcoded union so PII is never silently exposed.

## Non-goals / explicit decisions

- **No non-overridable floor.** The admin can hide *or expose* any column, including
  hard PII (`national_id`, `phone`, …). This is a deliberate owner decision. We
  mitigate — not prevent — with a PII badge, an un-hide confirmation, and an audit
  trail, but the code enforces no hard floor.
- **No quarantine of new columns.** Unlisted (including brand-new) columns are exposed
  by default. Accepted risk: a newly migrated PII column is exposable until an admin
  hides it.
- **Allowlist mode is out of scope.** The policy is deny-list only.

## Data model

New table, owned by `@openldr/dashboards` via `createColumnPolicyStore(db)` and a
migration:

```
column_exposure_policy (
  table_name  text        not null,
  column_name text        not null,
  updated_at  timestamptz not null default now(),
  updated_by  text,
  primary key (table_name, column_name)
)
```

**Row present ⇒ column hidden.** Absent ⇒ exposed. (Presence-only is sufficient
because unlisted = exposed; we keep `updated_at`/`updated_by` for provenance.)

The in-memory shape used by enforcement is `ColumnPolicy = Map<tableName, Set<hiddenColumn>>`.

### Seeding — union of today's denylists (the fail-safe bridge)

On first run the table is seeded from the **union, per table, of every hardcoded
denylist** (`JOINABLE_TABLES` + all `MODELS[].joins[].denyColumns`). The lists
differ today, so union is the conservative reconciliation — nothing hidden in *any*
context becomes newly exposed. Verified seed contents:

| table | seeded hidden columns |
|---|---|
| `patients` | id, patient_guid, surname, firstname, national_id, phone, email, date_of_birth, replaced_by_id, plugin_id, plugin_version, batch_id |
| `specimens` | id, patient_id, accession, source_system, plugin_id, plugin_version, batch_id |
| `lab_requests` | id, request_id, patient_id, source_system, plugin_id, plugin_version, batch_id |
| `facilities` | plugin_id, plugin_version, batch_id |
| `diagnostic_reports` | id, patient_id, plugin_id, plugin_version, batch_id |

**Intentional consequence:** `source_system` is denied in the per-model
specimen/request joins but *not* in the `JOINABLE_TABLES` specimen entry today. Under
the union it becomes hidden in the arbitrary-join universe as well — a strictly more
restrictive, safe change. An admin can un-hide it on the page.

The union constant (`HARDCODED_DENY_UNION`) is retained in `registry.ts` as both the
seed source and the runtime fallback.

## Enforcement threading

All enforcement and client projection **already run server-side** — `bootstrap`
wires `models: () => modelsForClient()` / `joinableTables: () => joinableTablesForClient()`,
and the query path enforces via `joinableColumns` / `exposableFor` inside
`compile.ts`. The browser only receives the already-filtered result. There is **no
client-side security logic to change.**

A `ColumnPolicy` is threaded into the six functions that read the hardcoded lists:

- `joinableColumns(jt, policy)`
- `exposableColumns(model, alias, policy)` and `exposableFor(model, alias, policy)`
- `getJoinableTable(table)` — unaffected (returns the table entry; policy applied by callers)
- `modelsForClient(models, policy)`
- `joinableTablesForClient(policy)`

and through `runBuilderQuery(db, model, q, policy)` →
`compileBuilderQuery(…, policy)` → `effectiveModel(model, q, policy)`.

Each function computes `EXTERNAL_TABLE_COLUMNS[table]` **minus** `policy.get(table)`
(falling back to `HARDCODED_DENY_UNION[table]` when the policy has no entry for the
table, e.g. empty store). The per-model `joins[].denyColumns` field is removed as a
policy input; it survives only inside `HARDCODED_DENY_UNION`.

**Join keys are unaffected.** `effectiveModel` validates a user join's `left`/`right`
keys against `EXTERNAL_TABLE_COLUMNS` (all real columns), not against the exposable
set. Hiding a column as *output* therefore never breaks its use as a join *key*.

### Policy loading & cache

`bootstrap` loads the policy into an **in-memory cache** at startup and refreshes it
when the page/CLI writes a change (the store exposes a `reload()` the write path
calls). The client-projection wiring becomes:

```
models: () => modelsForClient(MODELS, policyCache.current())
joinableTables: () => joinableTablesForClient(policyCache.current())
```

and `runDashboardQuery` passes `policyCache.current()` into `runBuilderQuery`.
`compileDashboardSql` passes it into `compileBuilderQuery`. Reads are from memory, so
no added latency on the hot path.

## API

Two routes (registered alongside the dashboard routes), both gated by
`data_exposure.manage`:

- `GET /api/dashboards/column-policy` → per table:
  `{ table, label, columns: [{ name, hidden, pii }], }` where `columns` is the full
  `EXTERNAL_TABLE_COLUMNS[table]`, `hidden` from the policy, `pii` from the code-level
  `PII_COLUMNS` classification.
- `PUT /api/dashboards/column-policy` → body: `{ [table]: hiddenColumnNames[] }`.
  Replaces the policy per table, `reload()`s the cache, and writes an audit event
  `data_exposure.policy.updated` (via `recordAudit`) capturing the diff and actor.

`PII_COLUMNS` is a code-level `Record<table, string[]>` in `registry.ts`, used **only**
for the badge/warning — it is display metadata, never an enforcement input.

## RBAC

New capability in `@openldr/rbac` catalog:

```
{ key: 'data_exposure.manage', group: 'data_exposure',
  label: 'Manage data exposure',
  description: 'Control which table columns may be exposed through dashboards, queries, and reports.' }
```

Added to the admin/labadmin preset(s). Gates both the API routes and the Settings
sub-nav entry.

## UI — Settings → Data Exposure

New sub-nav entry + nested route, exactly as `SettingsShell` documents (one `SUB_NAV`
entry `{ labelKey: 'settings.subNav.dataExposure', to: '/settings/data-exposure',
caps: ['data_exposure.manage'] }` + one `<Route>` in `App.tsx`).

Layout follows house conventions (edge-to-edge dividers, ⋯-dots menu for
Save/Cancel, label-left/input-right — copy an existing settings sibling):

- One collapsible section per governed table (Patient, Specimen, Request, Facility, Report).
- Each lists its columns with a **hidden/shown** toggle. Shown = exposed.
- PII-classified columns carry a red badge. Turning a PII column from hidden→shown
  opens a confirm dialog naming the column and the exposure risk.
- Header ⋯ menu: **Save** (persists diff, audit-logged) / **Discard**.
- i18n keys under `settings.dataExposure.*` (en/fr/pt).

## CLI parity

`openldr` commands, sharing the store through `@openldr/bootstrap`:

- `openldr data-exposure list [--table X]` — print the effective hidden columns.
- `openldr data-exposure hide <table> <column...>` / `openldr data-exposure show <table> <column...>`.

Writes go through the same store + audit path as the API.

## Testing

- **registry**: `joinableColumns` / `exposableColumns` / `modelsForClient` /
  `joinableTablesForClient` honor an injected policy; empty policy falls back to
  `HARDCODED_DENY_UNION` (regression: existing tests, e.g. "national_id not in
  patients columns", must still pass with an empty store).
- **compile**: an ad-hoc dimension on a column the *policy* hides is rejected; a column
  the policy *exposes* (previously denied) is now accepted; join keys still validate
  regardless of hidden state.
- **store**: seed = union; PUT replaces + `reload()` flips subsequent reads.
- **routes**: GET shape (hidden/pii flags); PUT requires `data_exposure.manage`,
  writes the audit event.
- **CLI**: list/hide/show round-trip through the store.
- **bootstrap wiring**: `dashboards.models()` reflects a written policy (extends the
  existing "real wiring" test).

## Risks

- **No hard floor** — an admin can expose real PII. Mitigated by badge + confirm +
  audit, not prevented. Owner-accepted.
- **New-column exposure** — a migrated PII column is exposable until hidden.
  Owner-accepted; the fallback union only protects the *known* columns.
- **Empty store before seed** — the fallback to `HARDCODED_DENY_UNION` must be wired
  before the first `models()` call so a seed failure never opens exposure.
