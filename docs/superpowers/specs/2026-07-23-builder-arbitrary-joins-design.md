# Widget Builder — Arbitrary (User-Defined) Joins Within an Admin-Governed Universe

**Date:** 2026-07-23
**Status:** Approved (brainstorm) — pending implementation plan
**Related:** [builder-join-data-relationships](2026-07-23-builder-join-data-relationships-design.md) (shipped; curated multi-relationship joins), [dynamic-builder-adhoc-joins](2026-07-23-dynamic-builder-adhoc-joins-design.md) (shipped; the `adhocDimensions`/`effectiveModel` machinery this reuses)

## Problem

The shipped "Join data" feature only lets a user activate **admin-declared relationships** (fixed table + fixed keys). Metabase, by contrast, lets a user join *any* joinable table on *keys they choose*, add many joins, even the same table twice. Feedback (with side-by-side screenshots): "Metabase can add multiple joins, but ours can only add one" — because a model like Test Orders (`lab_requests`) has exactly one foreign key (`patient_id → patients`), so only one curated relationship exists.

This was a **deliberate** limitation: earlier design explicitly rejected arbitrary manual joins (direction B) for PII / query-safety. The product owner has now chosen to open it up — but this system holds patient PII (the `patients` table has names, `national_id`, phone, email, `date_of_birth`), so "arbitrary" must not mean "ungoverned."

## Decisions (from brainstorm)

- **Direction: arbitrary joins inside an admin-governed universe.** The admin defines *which tables are joinable* and *which of their columns are exposable*; the user freely picks table + keys + columns within that envelope.
- **Column-exposure policy: admin-configurable per table.** Each joinable table carries an admin column policy (allowlist, or all-minus-denylist). Some tables fully open; PII tables stay guarded. **Fail-safe: a table with no admin policy exposes nothing** (mirrors today's "optional join without a denylist is not offered").
- **Join keys: warn, but allow any keys.** The user chooses `left = right`; both are validated to be real schema columns. Fan-out (a non-unique right key multiplying rows and inflating COUNT/SUM/AVG) is **warned in the UI, not blocked** — flagged when the right key isn't an admin-marked primary/unique column.
- **v1 scope: base table → joined table only, multi-join, aliased.** No chaining (joining onto an already-joined table). The same table may be joined more than once (distinct aliases). The existing admin `optionalJoins` presets remain as convenient one-click starting points.

## Safety / governance stance (explicit)

Arbitrary ≠ ungoverned. Three admin controls bound the feature; the server enforces all three regardless of what a hand-edited widget JSON claims:

1. **Table reachability.** Users may join only to tables in the admin `JoinableTable` set. A table absent from the set is unreachable; the compiler rejects a `userJoin` to an unlisted table.
2. **Column exposure.** Each joinable table's exposable columns = its admin allowlist, or `EXTERNAL_TABLE_COLUMNS[table]` minus its denylist. PII columns stay blocked where the admin blocks them. The compiler rejects any selected column outside the table's policy — the same server-side guard that protects the shipped curated joins. **No policy → nothing exposable (fail-safe closed).**
3. **Key validity.** `left`/`right` are validated to be real columns (base-model table column and joined-table column respectively) and are emitted as bound/validated `sql.ref`s, never interpolated raw. Fan-out is a data-shape risk, not an injection risk; it is warned, not blocked (per decision).

What the user gains over the curated version: choice of joinable table, choice of join keys, choice of columns, multiple/aliased joins. What stays under admin control: which tables are reachable and which columns (especially PII) may ever surface.

## Architecture

Reuses the shipped join machinery: a user join is **synthesized into a `ModelJoin` in the effective model**, after which `collectUsedJoins` → `leftJoin` and the `adhocDimensions` fold work unchanged.

### 1. Admin registry (`packages/dashboards/src/models/registry.ts`)

A new admin config describing the joinable universe:

```ts
export interface JoinableTable {
  table: keyof ExternalSchema;   // e.g. 'patients'
  label: string;                 // display name, e.g. 'Patient'
  columns?: string[];            // ALLOWLIST of exposable columns, OR…
  denyColumns?: string[];        // …all-minus-denylist. Exactly one is the policy.
  primaryKeys?: string[];        // columns that are unique/PK → no fan-out warning as the right key
}
```

- Declared globally or per model (the plan pins whether the joinable set is global or `QueryModel.joinableTables`; global is simpler and the base model's own table is the join source).
- Helper `joinableColumns(table): string[]` = the allowlist, or `EXTERNAL_TABLE_COLUMNS[table]` minus `denyColumns`; returns `[]` when neither is configured (fail-safe closed). Mirrors the existing `exposableColumns`.
- A client projection `joinableTablesForClient()` ships `{ table, label, columns: joinableColumns(table), primaryKeys, allColumns: EXTERNAL_TABLE_COLUMNS[table] }` — `allColumns` is needed so the UI can offer *key* columns (keys aren't limited to exposable output columns; but see Open questions on whether keys should also be policy-limited). Raw `denyColumns` never travel to the client.

### 2. Query schema (`packages/dashboards/src/types.ts`)

A new persisted field on the builder branch:

```ts
export const UserJoinSchema = z.object({
  id: z.string(),        // query-local alias; distinct id lets the same table be joined twice
  table: z.string(),     // must be in the admin JoinableTable set
  left: z.string(),      // base-model table column (ON left)
  right: z.string(),     // joined-table column (ON right)
  label: z.string().optional(),
});
// added to the builder WidgetQuerySchema:
userJoins: z.array(UserJoinSchema).optional(),
```

Columns selected from a user join reuse **`adhocDimensions`**: each such dimension's `join` field references the `UserJoin.id`. No new dimension type is needed.

### 3. Compiler (`packages/dashboards/src/compile.ts`)

Extend `effectiveModel(model, q)` (already folds ad-hoc join columns and custom columns). **Fold order matters:** synthesize user joins into `model.joins` **first**, *then* fold `adhocDimensions` (whose columns may reference a user-join alias and must validate against it), then fold `customColumns`. So the order becomes: **user joins → ad-hoc dimensions → custom columns.**

- For each `userJoin`, **validate**: `table` is in the admin `JoinableTable` set; `left` ∈ `EXTERNAL_TABLE_COLUMNS[baseTable]`; `right` ∈ `EXTERNAL_TABLE_COLUMNS[userJoin.table]`. Throw on any violation.
- **Synthesize a `ModelJoin`** `{ table, alias: userJoin.id, left, right, optional: true, denyColumns: <table policy> }` and append to `model.joins`. Now `exposableColumns(model, id)` reflects the table's admin policy.
- The `adhocDimensions` fold (existing) validates each selected column against `exposableColumns(model, join)` — which now resolves the synthesized join's admin policy. A column outside the policy is rejected exactly as today.
- `collectUsedJoins` + the `leftJoin` builder are **unchanged**: a synthesized user join is an ordinary alias in `model.joins`; `dimRef`/`colName` qualify its columns as `alias.column`; the `leftJoin` fires when referenced.

The one nuance: `collectUsedJoins` currently emits a join only when a *dimension* references its alias. A user join with columns selected → its adhoc dims reference the alias → it fires. (A user join with no columns selected yet is inert — no leftJoin, nothing to leak. Acceptable.)

### 4. Client API (`apps/studio/src/api.ts` + dashboards)

- Ship `joinableTables` (from `joinableTablesForClient`) alongside the model list, and mirror `UserJoin`/`JoinableTable` client types.
- Add `userJoins` to the client `WidgetQuery` builder branch.

### 5. UI (`apps/studio/src/dashboard/editor/`)

A real join builder, launched from the existing "Join data" affordance:

- **Add a join** → pick a **table** (from `joinableTables`), then **left key** (a column of the base model's table), **right key** (a column of the chosen table). A read-only-ish preview renders `Base ⋈ Table on left = right` (Metabase style).
- **Fan-out warning:** when the chosen `right` key is not in that table's `primaryKeys`, show an inline "this key isn't unique — counts may be inflated" note. Non-blocking.
- **Columns:** multi-select from the table's exposable `columns` → each becomes an `adhocDimension` referencing the join `id` (reuse `setRelationshipColumnsPatch`-style helpers, keyed by `id`).
- **Multiple/aliased:** each user join is its own block with its own `id`; the same table can be added again (new `id`). Removing a block removes its `userJoin` + its adhoc dims + orphan-cleans references.
- The shipped admin `optionalJoins` presets stay available as one-click starting points (they pre-fill table + keys).

New pure helpers in `builderForm.model.ts` (React/DOM-free, following the existing patch-function style): `addUserJoinPatch`, `removeUserJoinPatch` (removes the join + its adhoc dims + orphan-clean), `setUserJoinKeysPatch`. A `uniqueJoinId` generator for aliases.

## Testing & safety

- **Registry:** `joinableColumns` incl. fail-safe (no policy → `[]`); allowlist vs denylist; `joinableTablesForClient` strips raw denylists and includes PK flags.
- **Compiler:** synthesized user join compiles to a `leftJoin` with qualified refs; multiple user joins (incl. same table twice, distinct aliases) → multiple joins; **rejection** of a join to an unlisted table, of a non-exposable selected column, and of a `left`/`right` key that isn't a real schema column; keys emitted as bound refs (assert on `.compile()`).
- **PII regression:** a user join to `patients` selecting a denylisted column (e.g. `national_id`) is rejected server-side; `joinableTablesForClient` never emits denylisted patient columns.
- **Studio helpers:** add/remove user join, key edits, orphan cleanup; fan-out flag derivation (right key ∈ primaryKeys?).
- **UI:** add a join (table + keys + columns), fan-out warning appears for a non-PK right key, multiple/aliased joins, removal cleans up.
- **Regression:** existing curated `optionalJoins` join tests and the ad-hoc/custom-column suites stay green — user joins are additive; effective-model fold order is **user joins → ad-hoc → custom columns** (user joins synthesize into `model.joins` before their columns are validated in the ad-hoc fold).

## Scope / non-goals (v1)

- **Base table → joined table only.** No chaining onto an already-joined table (deferred).
- **Warn, don't block** fan-out.
- Keep admin `optionalJoins` presets; user joins are additive.
- No user-defined join *type* (LEFT only, as today); no aggregate/expression join conditions.
- Column governance is per-table admin config; a table with no policy is not joinable (fail-safe closed).

## Open questions for the plan

- **Global vs per-model joinable set.** Global `JoinableTable[]` is simplest (any base model can join any listed table). Per-model scoping is stricter but more config. Recommend global for v1; pin in plan.
- **Key-column governance.** Output *columns* are policy-limited; should *key* columns also be limited (e.g. disallow joining on a PII column even though it's not surfaced)? Keys aren't output, but a join predicate on `national_id` is still a data-use choice. Recommend: keys may be any real column of the two tables in v1 (they're not exposed), revisit if needed.
- **Alias/id generation + collision** with existing admin `optionalJoins` aliases (e.g. `jp`) — the `id` generator must avoid clashing with model join aliases and other user-join ids.
- **`allColumns` on the client** (for key pickers) leaks the *existence* of all column names of a joinable table (not their data). Confirm that's acceptable, or limit key options to a safe subset.
