# Upgrade Re-seed — refresh built-in reports + sample dashboard on upgrade

**Date:** 2026-07-13
**Branch:** `feat/upgrade-reseed`
**Predecessor:** R3e (drop thin + rename v2→canonical) DONE + pushed (`origin/main` `a6e263d1`)
**Motivation:** the R3e-deferred upgrade path.

## Context

The FHIR storage restructure's R3e slice dropped the thin external schema and renamed the `v2_*`
read-model tables to canonical names. Reports and the sample dashboard are seeded **idempotent-by-id
(skip-if-exists)**, so an existing install that upgrades keeps its previously-seeded DB rows — whose
SQL reads tables that no longer exist (thin tables dropped, or `v2_*` names renamed). Those built-in
reports and the sample dashboard therefore **break on upgrade**. Fresh installs are fine (they seed
the current canonical SQL). This slice makes upgrades self-heal.

## Goal

On the next boot (or `openldr db seed`) after an upgrade, refresh the built-in **SQL-mode** artifacts
to their current shipped definition, so their SQL is canonical and they work again — without touching
user-authored content.

## Scope (only what R3e broke)

- **The 9 built-in report queries** — stored as `custom_queries` rows keyed by their stable
  `SEED_QUERIES` ids (`q-facilities`, `q-test-volume`, `q-turnaround-time`, `q-patient-demographics`,
  `q-amr-resistance`, `q-amr-facility-summary`, `q-amr-glass-ris`, `q-amr-first-isolate-summary`,
  `q-amr-antibiogram`). Their `sql` is stale on upgraded installs.
- **The sample dashboard** — stored as the `dashboards` row `id:'default'` (`SAMPLE_DASHBOARD`), all
  widgets `mode:'sql'`, plus the `test` filter's `optionsSql`. Stale on upgraded installs.

**Explicitly out of scope (do not refresh):**

- **Builder-mode dashboards** — they store model + dimension *keys*, compiled to SQL at query time via
  the query-model registry (`packages/dashboards/src/models/registry.ts`), which R3e already repointed
  to canonical. They self-heal; no stored SQL to refresh.
- **Report designs** (`report_designs`) — free-form page layouts binding to query *result-column
  keys*, not tables/columns; a table rename doesn't affect them.
- **Report defs** (`reports`) — metadata (name/category/param_options/chart/summary_metrics) +
  references to stable query/design ids; unaffected by the rename.
- **User-authored reports / dashboards / custom queries** — different ids; never visited (the refresh
  iterates only the known built-in id sets, so user content is structurally untouched).

## Design decision (resolved in brainstorming)

**Managed-overwrite.** For each built-in id, if the stored content differs from the current shipped
seed definition, overwrite it; otherwise no-op. Chosen over "stale-only heal" (overwrite only
detectably-broken rows) because:

- It **heals every install deterministically** regardless of vintage (thin / `v2_` / mixed) — it makes
  built-ins match the shipped definition rather than trying to *detect* staleness. Staleness detection
  is unreliable here: canonical reuses the names `patients`/`specimens`/`diagnostic_reports`, so a
  thin query reading `from patients` with dropped *columns* (`birth_date`/`gender`) breaks at the
  column level and would slip past table-name detection.
- No historical-SQL manifest, no per-boot SQL execution against the warehouse.
- The only cost — overwriting an operator's *in-place* edit to a built-in — is a niche action, and
  such an edit is already broken on an upgraded install. Principle: built-ins are product-managed;
  clone to customize (a clone gets a new id, which the refresh then never visits).

## Design

The refresh runs on the **existing seed path** (`seedDatabase`, invoked by the server's
`SEED_ON_START` boot and the `openldr db seed` CLI). No new migration; no manual step; it happens
automatically on the next boot after upgrade. Idempotent — a no-op once everything is canonical.

### 1. `seedDataDrivenReports` — refresh the built-in report queries

`packages/reporting/src/seed/report-seeds.ts`. Currently the `customQueries` loop is:

```ts
for (const q of SEED_QUERIES) {
  if (!(await deps.customQueries.get(q.id))) {
    await deps.customQueries.create({ ...q, sql: q.sql[dialect], connectorId: connector.id });
    queriesSeeded += 1;
  }
}
```

Change it to create-if-absent, else refresh-if-changed:

```ts
for (const q of SEED_QUERIES) {
  const want = { sql: q.sql[dialect], params: q.params };
  const existing = await deps.customQueries.get(q.id);
  if (!existing) {
    await deps.customQueries.create({ ...q, sql: want.sql, connectorId: connector.id });
    queriesSeeded += 1;
  } else if (existing.sql !== want.sql || !paramsEqual(existing.params, want.params)) {
    await deps.customQueries.update(q.id, { sql: want.sql, params: want.params });
    queriesUpdated += 1;
  }
}
```

- Compare stored `sql` (string) to the shipped `q.sql[dialect]`; compare stored `params` to the
  shipped `q.params` with a small structural equality helper (`paramsEqual` — deep compare, e.g.
  `JSON.stringify` of normalized param arrays; params rarely change but a general refresh should
  cover them).
- `customQueries.update(id, patch)` already exists (`packages/db/src/custom-query-store.ts`) and
  stamps `updated_at`. Update **only** `sql`/`params` — do NOT touch `connectorId` (preserve the
  operator's connector binding; the dialect used for `q.sql[dialect]` comes from that resolved
  default-warehouse connector, exactly as the create path does).
- The `designs` and `reportDefs` loops stay skip-if-exists (out of scope — unchanged by R3e).
- Extend `SeedDataDrivenReportsResult` with `queriesUpdated: number` (and keep `queriesSeeded` for
  fresh creates).

### 2. `seedDefaultDashboard` — refresh the sample dashboard

`packages/dashboards/src/seed.ts`. Currently:

```ts
export async function seedDefaultDashboard(store: Pick<DashboardStore, 'get' | 'create'>): Promise<number> {
  if (await store.get(SAMPLE_DASHBOARD.id)) return 0;
  await store.create(SAMPLE_DASHBOARD);
  return 1;
}
```

Change to create-if-absent, else replace-if-changed (widen the `Pick` to include `update`):

```ts
export interface SeedDashboardResult { created: number; updated: number }

export async function seedDefaultDashboard(store: Pick<DashboardStore, 'get' | 'create' | 'update'>): Promise<SeedDashboardResult> {
  const existing = await store.get(SAMPLE_DASHBOARD.id);
  if (!existing) {
    await store.create(SAMPLE_DASHBOARD);
    return { created: 1, updated: 0 };
  }
  if (!dashboardContentEqual(existing, SAMPLE_DASHBOARD)) {
    await store.update(SAMPLE_DASHBOARD.id, SAMPLE_DASHBOARD);
    return { created: 0, updated: 1 };
  }
  return { created: 0, updated: 0 };
}
```

- `dashboardContentEqual` compares the seed-relevant fields (`name`, `filters`, `widgets`, `layout`)
  — e.g. `JSON.stringify` of `{ name, filters, widgets, layout }` on each side (ignoring
  `id`/`ownerId`/`isDefault`/timestamps, which the store manages). If they differ, replace wholesale
  with `SAMPLE_DASHBOARD` (managed-overwrite: this also replaces any operator layout customization of
  the `default` board — the accepted tradeoff).
- `dashboardStore.update(id, d)` already exists (`packages/dashboards/src/store.ts`).
- The return type changes from `number` to `SeedDashboardResult`; update the two callers
  (`seedDatabase` in `bootstrap/src/seed.ts` and the boot path in `bootstrap/src/index.ts:857`) — see §3.

### 3. Thread the counts through `seedDatabase`

`packages/bootstrap/src/seed.ts` — `seedDatabase` already surfaces per-artifact counts in
`SeedResult`. Update:

- `dashboardsSeeded` (currently the `number` from `seedDefaultDashboard`) → use the new
  `SeedDashboardResult`; expose `dashboardsSeeded`/`dashboardsUpdated` (or keep `dashboardsSeeded` =
  `created` and add `dashboardsUpdated` = `updated`) in `SeedResult`.
- `dataDrivenReportsSeeded` already carries the `SeedDataDrivenReportsResult`; it now includes
  `queriesUpdated` automatically.
- `bootstrap/src/index.ts:857` calls `seedDefaultDashboard(ctx.dashboards.store)` on boot — update
  its use of the return value (it likely just logs/ignores it; adjust to the new shape).

These counts are for observability (logged by the seed CLI / boot); no behavior depends on them.

## Testing strategy

- **Unit — report-query refresh** (`report-seeds.test.ts` or the seed test): with a fake
  `customQueries` store, (a) an absent built-in id → created; (b) a present id whose stored `sql`
  differs from the current `q.sql[dialect]` → `update` called with the canonical sql, `queriesUpdated`
  incremented; (c) a present id whose stored sql already equals canonical → no `update` (idempotent);
  (d) `connectorId` is preserved (update patch has no `connectorId`).
- **Unit — dashboard refresh** (`dashboards` seed test): (a) absent `default` → created; (b) present
  `default` with divergent widget SQL → `update` called with `SAMPLE_DASHBOARD`, `updated:1`; (c)
  present `default` identical to `SAMPLE_DASHBOARD` → no update.
- **Real-PG upgrade simulation** (extend the existing bootstrap seed test that runs against a migrated
  DB, if present): seed a built-in report query row with an OLD (e.g. `v2_lab_results`- or
  thin-reading) `sql` + the sample dashboard with stale widget SQL, run `seedDatabase` (or the two
  refresh functions), then assert the stored `sql` is now the canonical `SEED_QUERIES` sql and the
  dashboard matches `SAMPLE_DASHBOARD`. (If no such harness exists, the unit tests above with fake
  stores are sufficient; do not build new live infra for this.)
- **Type gate:** `tsc --noEmit` on `@openldr/reporting`, `@openldr/dashboards`, `@openldr/bootstrap`
  (the return-type change on `seedDefaultDashboard` + `SeedResult` shape must propagate).
- **Cross-package gate:** `pnpm turbo run typecheck test --force` (ignore the known `@openldr/users`
  /`@openldr/marketplace` parallel-turbo flakes — verify in isolation).

## Task breakdown (~4)

1. **Report-query refresh** — `seedDataDrivenReports` create-or-update-if-changed for the
   `customQueries` loop; `paramsEqual` helper; `queriesUpdated` on `SeedDataDrivenReportsResult`; unit
   tests (a)–(d).
2. **Dashboard refresh** — `seedDefaultDashboard` create-or-replace-if-changed; `dashboardContentEqual`
   helper; `SeedDashboardResult` return type; unit tests.
3. **Thread counts** — update `seedDatabase`'s `SeedResult` + the two `seedDefaultDashboard` callers
   (`bootstrap/src/seed.ts`, `bootstrap/src/index.ts`); fix the seed CLI/boot logging of the new
   fields; per-package `tsc` green.
4. **Whole-slice review, gate, merge & push** — cross-package gate; spec-conformance + quality review;
   merge `--no-ff` to `main` + push; update memory (R3e upgrade-reseed deferral resolved).

## Constraints & conventions

- Runs on the existing seed path (boot + `openldr db seed`); no new migration, no manual upgrade step.
- Idempotent: no writes once all built-ins are canonical.
- Refresh iterates only the known built-in id sets — user content (other ids) is never visited.
- Preserve `connectorId` on report-query refresh (update `sql`/`params` only).
- Managed-overwrite replaces operator in-place edits to built-ins (documented tradeoff).
- No `Co-Authored-By: Claude`/`Codex` trailers on commits or PRs.
- Work merges to local `main` (`--no-ff`); push to origin when green.
