# Upgrade Re-seed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On the next boot / `openldr db seed` after an upgrade, refresh the built-in SQL-mode report queries + sample dashboard to their current shipped (canonical) definition, so R3e's rename/drop doesn't leave upgraded installs with broken built-ins — without touching user-authored content.

**Architecture:** Managed-overwrite on the existing seed path. Turn the two skip-if-exists loops (`seedDataDrivenReports`' `customQueries` loop; `seedDefaultDashboard`) into create-if-absent / refresh-if-changed. Idempotent (no write once canonical); iterates only known built-in ids (user content, other ids, never visited). No new migration; automatic on next boot.

**Tech Stack:** TypeScript, Vitest (in-memory fakes), pnpm/turbo.

**Spec:** `docs/superpowers/specs/2026-07-13-upgrade-reseed-design.md`

---

## Task 0: Cut the branch

**Files:** none (git).

- [ ] **Step 1**

Run:
```bash
git checkout -b feat/upgrade-reseed
git branch --show-current
```
Expected: `feat/upgrade-reseed`. Clean tree (spec committed on `main` at `e5ccd3dd`, included here).

---

## Task 1: Refresh built-in report queries in `seedDataDrivenReports`

**Files:**
- Modify: `packages/reporting/src/seed/report-seeds.ts` (`SeedDataDrivenReportsDeps`, `SeedDataDrivenReportsResult`, `seedDataDrivenReports`)
- Test: `packages/reporting/src/seed/report-seeds.test.ts`

- [ ] **Step 1: Widen the deps + result types**

In `report-seeds.ts`:
- `SeedDataDrivenReportsDeps.customQueries` (currently `Pick<CustomQueryStore, 'get' | 'create'>`) → add `'update'`: `Pick<CustomQueryStore, 'get' | 'create' | 'update'>`.
- `SeedDataDrivenReportsResult` — add `queriesUpdated: number`:
```ts
export interface SeedDataDrivenReportsResult {
  queriesSeeded: number;
  queriesUpdated: number;
  designsSeeded: number;
  reportDefsSeeded: number;
}
```
- Update `EMPTY_RESULT` to `{ queriesSeeded: 0, queriesUpdated: 0, designsSeeded: 0, reportDefsSeeded: 0 }`.

- [ ] **Step 2: Add a `paramsEqual` helper + rewrite the customQueries loop**

Add near the top of the `seedDataDrivenReports` area (module-local):
```ts
// Structural equality for a seed query's params vs. the stored params (order-sensitive; params are
// authored as an ordered array). Cheap JSON compare — params are small and plain.
function paramsEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? []) === JSON.stringify(b ?? []);
}
```
Rewrite the `customQueries` loop in `seedDataDrivenReports` (currently create-if-absent) to also refresh a changed built-in — managed-overwrite of `sql`/`params` only, preserving `connectorId`:
```ts
  let queriesSeeded = 0;
  let queriesUpdated = 0;
  for (const q of SEED_QUERIES) {
    const wantSql = q.sql[dialect];
    const existing = await deps.customQueries.get(q.id);
    if (!existing) {
      await deps.customQueries.create({ ...q, sql: wantSql, connectorId: connector.id });
      queriesSeeded += 1;
    } else if (existing.sql !== wantSql || !paramsEqual(existing.params, q.params)) {
      // Managed-overwrite: refresh the built-in's SQL/params to the current shipped definition on
      // upgrade (R3e renamed the read-model tables, so a previously-seeded row's SQL is stale).
      // connectorId is intentionally NOT patched — preserve the operator's connector binding.
      await deps.customQueries.update(q.id, { sql: wantSql, params: q.params });
      queriesUpdated += 1;
    }
  }
```
Leave the `designs` and `reportDefs` loops unchanged (skip-if-exists — out of scope). Return
`{ queriesSeeded, queriesUpdated, designsSeeded, reportDefsSeeded }`.

- [ ] **Step 3: Update the existing tests' result assertions (they gain `queriesUpdated`)**

In `report-seeds.test.ts`, the `fakeDeps` `customQueries` fake must store `params` and gain `update`. Replace the `customQueries` fake:
```ts
    customQueries: {
      get: async (id) => (queries.has(id) ? (queries.get(id) as never) : null),
      create: async (q) => {
        queries.set(q.id, { id: q.id, connectorId: q.connectorId, sql: q.sql, params: q.params });
      },
      update: async (id, patch) => {
        const cur = queries.get(id);
        if (cur) queries.set(id, { ...cur, ...('sql' in patch ? { sql: patch.sql } : {}), ...('params' in patch ? { params: patch.params } : {}) });
      },
    },
```
and change the `queries` Map value type to include `params` and `sql`: `Map<string, { id: string; connectorId: string; sql: string; params?: unknown }>`.
Update every `expect(res).toEqual({ queriesSeeded, designsSeeded, reportDefsSeeded })` to include `queriesUpdated: 0` — the three occurrences at the "skips entirely" test, the "differently-named connector" test, the "resolves + stamps" test, and the "idempotent" test. E.g.:
```ts
    expect(res).toEqual({ queriesSeeded: 0, queriesUpdated: 0, designsSeeded: 0, reportDefsSeeded: 0 });
```
and the resolves-and-stamps one:
```ts
    expect(res).toEqual({
      queriesSeeded: SEED_QUERIES.length,
      queriesUpdated: 0,
      designsSeeded: SEED_DESIGNS.length,
      reportDefsSeeded: SEED_REPORT_DEFS.length,
    });
```

- [ ] **Step 4: Add refresh unit tests**

Append to the `describe('seedDataDrivenReports', ...)` block:
```ts
  it('refreshes a built-in query whose stored SQL is stale (managed-overwrite), preserving connectorId', async () => {
    const { deps, queries } = fakeDeps([{ id: 'conn-123', name: DEFAULT_CONNECTOR_NAME, type: 'postgres' }]);
    // Simulate an upgraded install: q-test-volume seeded earlier with STALE (v2_-reading) SQL under a
    // different connector binding the operator set.
    queries.set('q-test-volume', { id: 'q-test-volume', connectorId: 'operator-conn', sql: 'select 1 from v2_lab_requests', params: [] });
    const res = await seedDataDrivenReports(deps);
    const refreshed = queries.get('q-test-volume')!;
    expect(refreshed.sql).toBe(SEED_QUERIES.find((q) => q.id === 'q-test-volume')!.sql.postgres);
    expect(refreshed.sql).not.toContain('v2_lab_requests');
    expect(refreshed.connectorId).toBe('operator-conn'); // connectorId preserved, not rebound
    expect(res.queriesUpdated).toBeGreaterThanOrEqual(1);
    // the other 8 built-ins were absent → created
    expect(res.queriesSeeded).toBe(SEED_QUERIES.length - 1);
  });

  it('does not rewrite a built-in query whose stored SQL already equals the shipped canonical (idempotent)', async () => {
    const { deps, queries } = fakeDeps([{ id: 'conn-123', name: DEFAULT_CONNECTOR_NAME, type: 'postgres' }]);
    await seedDataDrivenReports(deps);        // first run creates all
    const before = new Map([...queries].map(([k, v]) => [k, v.sql]));
    const res2 = await seedDataDrivenReports(deps); // second run: everything already canonical
    expect(res2.queriesUpdated).toBe(0);
    expect(res2.queriesSeeded).toBe(0);
    for (const [id, v] of queries) expect(v.sql).toBe(before.get(id)); // unchanged
  });
```

- [ ] **Step 5: Verify**

Run: `pnpm --filter @openldr/reporting exec vitest run src/seed/report-seeds.test.ts`
Expected: PASS (existing tests updated for `queriesUpdated`, 2 new refresh tests green).
Run: `pnpm --filter @openldr/reporting exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/reporting/src/seed/report-seeds.ts packages/reporting/src/seed/report-seeds.test.ts
git commit -m "feat(reporting): upgrade re-seed refreshes stale built-in report queries (managed-overwrite)"
```
No `Co-Authored-By` trailer.

---

## Task 2: Refresh the sample dashboard in `seedDefaultDashboard`

**Files:**
- Modify: `packages/dashboards/src/seed.ts` (`seedDefaultDashboard`)
- Modify: `packages/bootstrap/src/seed.ts` (`FormSeedTarget.dashboards.store` `Pick` — add `'update'`)
- Test: the dashboards seed test (`packages/dashboards/src/seed.test.ts` — confirm the filename; it holds the `collectVettedSqlTemplates`/`seedDefaultDashboard` tests)

- [ ] **Step 1: Rewrite `seedDefaultDashboard` to create-or-refresh**

In `packages/dashboards/src/seed.ts`, add a content-equality helper + rewrite the function (keep the `number` return):
```ts
// Compare only the seed-relevant fields — id/ownerId/isDefault/timestamps are store-managed.
function dashboardContentEqual(a: Dashboard, b: Dashboard): boolean {
  const pick = (d: Dashboard) => JSON.stringify({ name: d.name, filters: d.filters, widgets: d.widgets, layout: d.layout });
  return pick(a) === pick(b);
}

export async function seedDefaultDashboard(store: Pick<DashboardStore, 'get' | 'create' | 'update'>): Promise<number> {
  const existing = await store.get(SAMPLE_DASHBOARD.id);
  if (!existing) {
    await store.create(SAMPLE_DASHBOARD);
    return 1;
  }
  // Managed-overwrite: refresh the built-in sample to the current shipped definition on upgrade
  // (R3e cut its widget SQL over to canonical tables). Replaces any operator customization of the
  // `default` board — the accepted tradeoff of the managed-overwrite policy.
  if (!dashboardContentEqual(existing, SAMPLE_DASHBOARD)) {
    await store.update(SAMPLE_DASHBOARD.id, SAMPLE_DASHBOARD);
    return 1;
  }
  return 0;
}
```
Ensure `Dashboard` + `SAMPLE_DASHBOARD` are imported (the file already imports `SAMPLE_DASHBOARD`; add `import type { Dashboard } from './types';` if not already present).

- [ ] **Step 2: Widen the `FormSeedTarget` Pick**

In `packages/bootstrap/src/seed.ts`, the `FormSeedTarget.dashboards` field is
`{ store: Pick<DashboardStore, 'get' | 'create'> }` — change to
`{ store: Pick<DashboardStore, 'get' | 'create' | 'update'> }`. (The real `AppContext.dashboards.store`
already has `update`; this only widens the structural requirement. The other caller —
`dangerResetDashboards` in `bootstrap/src/index.ts` — passes the full store, so it needs no change.)

- [ ] **Step 3: Verify the dashboards seed test filename + update/add tests**

Find the test: `ls packages/dashboards/src/seed.test.ts` (or grep `seedDefaultDashboard` under `packages/dashboards/src`). Read it. It likely tests `seedDefaultDashboard` with a fake store that has `get`/`create`. Update the fake to add `update`, and add cases:
```ts
  it('creates the sample when absent', async () => {
    const rows = new Map<string, Dashboard>();
    const store = {
      get: async (id: string) => rows.get(id) ?? null,
      create: async (d: Dashboard) => { rows.set(d.id, d); return d; },
      update: async (id: string, d: Dashboard) => { rows.set(id, { ...d, id }); return d; },
    };
    expect(await seedDefaultDashboard(store)).toBe(1);
    expect(rows.get('default')).toBeTruthy();
  });

  it('refreshes the sample when the stored content differs (managed-overwrite)', async () => {
    const stale = { ...SAMPLE_DASHBOARD, widgets: [] } as Dashboard; // simulate an old/stale stored board
    const rows = new Map<string, Dashboard>([['default', stale]]);
    const store = {
      get: async (id: string) => rows.get(id) ?? null,
      create: async (d: Dashboard) => { rows.set(d.id, d); return d; },
      update: async (id: string, d: Dashboard) => { rows.set(id, { ...d, id }); return d; },
    };
    expect(await seedDefaultDashboard(store)).toBe(1);
    expect(rows.get('default')!.widgets.length).toBe(SAMPLE_DASHBOARD.widgets.length); // refreshed
  });

  it('is a no-op when the stored sample already matches (idempotent)', async () => {
    const rows = new Map<string, Dashboard>([['default', SAMPLE_DASHBOARD]]);
    let updates = 0;
    const store = {
      get: async (id: string) => rows.get(id) ?? null,
      create: async (d: Dashboard) => { rows.set(d.id, d); return d; },
      update: async (id: string, d: Dashboard) => { updates++; rows.set(id, { ...d, id }); return d; },
    };
    expect(await seedDefaultDashboard(store)).toBe(0);
    expect(updates).toBe(0);
  });
```
Import `SAMPLE_DASHBOARD` + `Dashboard` type in the test if not already. If an existing test asserted `seedDefaultDashboard` returns `1`/`0` under the old skip-only semantics and still holds, keep it; if one asserted "returns 0 when it already exists" (old skip behavior) that is now context-dependent (0 only when identical), update it to seed an already-identical `SAMPLE_DASHBOARD` so it still means "no write."

- [ ] **Step 4: Verify**

Run: `pnpm --filter @openldr/dashboards exec vitest run` and `pnpm --filter @openldr/dashboards exec tsc --noEmit` — expect PASS.
Run: `pnpm --filter @openldr/bootstrap exec tsc --noEmit` — expect PASS (the widened `Pick` + unchanged callers typecheck; `seedDefaultDashboard` still returns `number` so `dashboardsSeeded` and the CLI log are unaffected).

- [ ] **Step 5: Commit**

```bash
git add packages/dashboards/src/seed.ts packages/dashboards/src/seed.test.ts packages/bootstrap/src/seed.ts
git commit -m "feat(dashboards): upgrade re-seed refreshes the stale sample dashboard (managed-overwrite)"
```
No `Co-Authored-By` trailer.

---

## Task 3: Whole-slice review, gate, merge & push

**Files:** none (review + git).

- [ ] **Step 1: Cross-package gate**

Run: `pnpm turbo run typecheck test --force`
Expected: PASS for `@openldr/reporting`, `@openldr/dashboards`, `@openldr/bootstrap` (and no NEW failures). **Never pipe turbo through `tail`.** The known `@openldr/users`/`@openldr/marketplace` parallel-turbo flakes are ignorable — verify each passes via `pnpm --filter <pkg> test` in isolation; `@openldr/cli#build` Windows-native failure is ignorable.

- [ ] **Step 2: Whole-slice review**

Re-read the diff vs the spec: `seedDataDrivenReports` create-or-refresh (sql/params, connectorId preserved, `queriesUpdated` reported); designs/reportDefs untouched; `seedDefaultDashboard` create-or-refresh (content-equal guard, `number` return kept); only the built-in id sets are iterated (user content never visited); refresh is idempotent. Confirm no `Co-Authored-By` trailer, and that no migration / no new boot step was added (runs on the existing seed path).

- [ ] **Step 3: Merge to local `main` (no-ff) + push**

```bash
git checkout main
git merge --no-ff feat/upgrade-reseed -m "Merge branch 'feat/upgrade-reseed': refresh built-in reports + sample dashboard on upgrade (managed-overwrite)"
git log --oneline -1
git push origin main
```
Expected: clean merge; push succeeds.

- [ ] **Step 4: Update memory**

Update `fhir-storage-restructure-workstream.md` + `MEMORY.md`: the R3e-deferred **upgrade re-seed is DONE** (managed-overwrite of the 9 built-in report queries + sample dashboard on the existing seed path; builder-mode + designs/defs self-heal/unaffected; live MSSQL/MySQL runs remain the sole open R3e deferral). New `origin/main` SHA.

---

## Self-review notes

- **Spec coverage:** report-query refresh (§Design.1)→Task 1; dashboard refresh (§Design.2)→Task 2; counts (§Design.3, minimal — `queriesUpdated` added, dashboard stays `number`)→absorbed into Tasks 1–2; review/gate/merge→Task 3. All covered.
- **Scope discipline:** only the two SQL-mode built-in surfaces are refreshed; builder dashboards (registry-compiled), report designs (layout), report defs (metadata) are out of scope and untouched — matches the spec.
- **No clobber of user content:** both refresh loops iterate only the known built-in id sets (`SEED_QUERIES` ids, dashboard `default`); a user-authored artifact has a different id and is never visited.
- **Idempotency:** both refreshes compare before writing → no-op once canonical (proven by the "already matches" tests).
- **Consistency:** `paramsEqual`/`dashboardContentEqual` both compare via `JSON.stringify` of the seed-relevant fields; `connectorId` preserved on query refresh; `number` return on `seedDefaultDashboard` keeps `SeedResult`/CLI unchanged.
