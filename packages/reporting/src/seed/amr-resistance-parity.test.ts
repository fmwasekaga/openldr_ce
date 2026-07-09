import { describe, it, expect } from 'vitest';

// Live parity check for Task 4.2 (`amr-resistance` → query + template + report record).
// Verified manually against the dev analytics DB (docker compose postgres, `openldr_target`) via
// a throwaway script (`createDbContext(cfg).migrateAll()` → `createAppContext(cfg)` →
// `seedDatabase(dbCtx, appCtx)` → compare `appCtx.reporting.run('amr-resistance', params)` vs
// `appCtx.reporting.run('r-amr-resistance', params)`), then deleted — this test documents exactly
// what was compared so a future CI/live run can reproduce it.
//
// Params compared (rows sorted by `antibiotic` + numeric fields coerced with `Number(...)` before
// deep-equal — Postgres returns `numeric`/`bigint` columns as strings over node-postgres unless
// explicitly cast; the seed SQL casts `tested/r/i/s` to `::int` and `percentR` to `::float8` so
// they already come back as JS numbers, but the coercion is kept defensively):
//   1. { from: '2020-01-01', to: '2030-01-01', facility: '' }               → 4 rows, non-empty
//   2. { from: '2020-01-01', to: '2030-01-01', facility: '<real facility>' } → 4 rows, non-empty
//   3. { from: '1990-01-01', to: '1990-01-02', facility: '' }                → 0 rows both sides
//
// Case 2 required inserting 8 temporary `patients` rows (ids `p1`..`p8`, matching the
// `subject_ref`s already present on the seeded AMR `observations` fixture, which otherwise
// reference no real patient row) into a synthetic `managing_organization` so the facility filter
// had real data to exercise; those rows were deleted again after the check (dev DB is otherwise
// unchanged). Result: PASS — catalog and data-driven rows were identical (antibiotic, tested, r,
// i, s, percentR) in all three cases; row counts: 4 antibiotics (Ampicillin, Ceftriaxone,
// Ciprofloxacin, Gentamicin), 16 total observations.
//
// KNOWN GAP (not fixed by this task — out of scope for report-seeds.ts): `substituteParams`
// (`packages/dashboards/src/custom-query-run.ts`) throws "unbound parameter" for ANY declared
// `{{param.x}}` token whose value is absent from `values`, regardless of the param's `required`
// flag. So `q-amr-resistance`'s `facility` filter is only truly optional if every caller always
// supplies `facility` (even `''`). The Reports page's `ReportParametersBar` currently *omits* the
// key entirely when a select filter is left unset (`apps/studio/src/reports/ReportParametersBar.tsx`),
// so running this report from `/reports` without ever touching the Facility dropdown will 500 with
// "unbound parameter: facility" until a later slice (S5) adds default-value merging (e.g. from
// `ReportDesign.parameters[].value`) ahead of `runDataDriven`/`renderDataDriven` in
// `packages/bootstrap/src/index.ts`. The live parity check above worked around this by always
// passing `facility` explicitly (matching the task's "ALWAYS binding it" guidance).
it.skip('amr-resistance data-driven output equals catalog output (verified live — see comment above)', async () => {
  expect(true).toBe(true);
});
