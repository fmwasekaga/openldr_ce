import { describe, it, expect, afterEach } from 'vitest';
import { makeMigratedDb } from '@openldr/db/testing';
import { createAppSettingsStore, createReportStore, createRoleStore, referenceCapture } from '@openldr/db';
import { createDashboardStore } from '@openldr/dashboards';
import { createFormStore } from '@openldr/forms';
import type { Config } from '@openldr/config';
import { createAppContext, type AppContext } from './index';
import { truncateTables } from './danger';

const cfg: Config = Object.freeze({
  NODE_ENV: 'test',
  PORT: 3000,
  LOG_LEVEL: 'silent',
  AUTH_ADAPTER: 'keycloak',
  BLOB_ADAPTER: 'minio',
  EVENTING_ADAPTER: 'pg',
  TARGET_STORE_ADAPTER: 'pg',
  INTERNAL_DATABASE_URL: 'postgres://u:p@127.0.0.1:5499/none',
  TARGET_DATABASE_URL: 'postgres://u:p@127.0.0.1:5499/none',
  S3_ENDPOINT: 'http://127.0.0.1:9499',
  S3_REGION: 'us-east-1',
  S3_ACCESS_KEY_ID: 'x',
  S3_SECRET_ACCESS_KEY: 'xxxxxxxx',
  S3_BUCKET: 'none',
  S3_FORCE_PATH_STYLE: true,
  OIDC_ISSUER_URL: 'http://127.0.0.1:8499/realms/master',
}) as Config;

let ctx: AppContext;
afterEach(async () => { await ctx?.close(); });

describe('createAppContext', () => {
  it('wires and registers all four port health checks', async () => {
    ctx = await createAppContext(cfg);
    const out = await ctx.health.runAll();
    expect(Object.keys(out.checks).sort()).toEqual(['auth', 'blob', 'eventing', 'target-store']);
    expect(typeof ctx.terminology.ontology.listDistributions).toBe('function');
    expect(typeof ctx.terminology.loaders.loinc).toBe('function');
    expect(typeof ctx.forms.list).toBe('function');
    // RBAC Task 4: ctx.roles is on AppContext (shape check only — no live DB here, see below
    // for the seeded-roles integration test against a real migrated db).
    expect(typeof ctx.roles.list).toBe('function');
    expect(typeof ctx.roles.seedSystemRoles).toBe('function');
    expect(typeof ctx.plugins.list).toBe('function');
    expect(typeof ctx.plugins.install).toBe('function');
    expect(typeof ctx.plugins.rollback).toBe('function');
    expect(typeof ctx.plugins.setEnabled).toBe('function');
    expect(typeof ctx.plugins.remove).toBe('function');
    // Nothing reachable in this test → overall down, but no crash.
    expect(out.status).toBe('down');
  }, 20000);

  // Coverage gap closed: the route-level test (apps/server/src/dashboards-routes.test.ts) mocks
  // ctx.dashboards entirely, so it never exercises the real `models: () => modelsForClient()`
  // wiring in index.ts. This builds the real AppContext (same as above) and calls the real
  // dashboards.models() — modelsForClient() is pure (no DB/pg), so this is safe without a live DB.
  it('dashboards.models() returns the PII-safe client projection (real wiring)', async () => {
    ctx = await createAppContext(cfg);
    const models = ctx.dashboards.models();
    const sr = models.find((m) => m.id === 'service_requests')!;
    expect((sr as Record<string, unknown>).joins).toBeUndefined(); // raw joins never exposed
    const jp = sr.optionalJoins?.find((j) => j.alias === 'jp');
    expect(jp?.label).toBe('Patient');
    expect(jp?.exposableColumns).toContain('managing_organization');
    expect(jp?.exposableColumns).not.toContain('surname'); // denied PII absent
  }, 20000);
});

/**
 * Regression guard for the S2 CRITICAL integration gap: `createAppContext` must construct the four
 * reference-config stores WITH `referenceCapture`, or nothing is ever written to
 * `reference_change_log` and `POST /api/sync/pull` returns empty forever (the feature is inert in
 * production — the acceptance harness wired capture itself and masked it).
 *
 * `createAppContext` opens real pg pools + a LISTEN client from a URL, so it can't run against
 * pg-mem in a unit test. This mirrors bootstrap's exact construction (same factories, same
 * `referenceCapture` binding, imported the same way index.ts imports them) against a fully-migrated
 * db and proves a write THROUGH each store lands a log row. If a future edit drops the capture arg
 * from any of the four constructions in index.ts, this construction — and thus the guarantee — breaks
 * in the same way, and the matching case here fails.
 */
describe('createAppContext reference-capture wiring (S2 pull source)', () => {
  const refLog = (db: Awaited<ReturnType<typeof makeMigratedDb>>, entityId: string) =>
    db.selectFrom('reference_change_log').selectAll().where('entity_id', '=', entityId).orderBy('seq').execute();

  it('app_settings.set of a center-owned key lands a reference_change_log row', async () => {
    const db = await makeMigratedDb();
    const appSettings = createAppSettingsStore(db, referenceCapture); // bootstrap construction
    await appSettings.set('dashboard.raw_sql', 'true', 'test');
    const log = await refLog(db, 'dashboard.raw_sql');
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ entity_type: 'setting', op: 'upsert' });
  });

  it('dashboard create lands a reference_change_log row', async () => {
    const db = await makeMigratedDb();
    const dashboards = createDashboardStore(db, referenceCapture); // bootstrap construction
    await dashboards.create({ id: 'd1', name: 'Main', layout: [], widgets: [], filters: [], refreshIntervalSec: 0, isDefault: true, ownerId: null });
    const log = await refLog(db, 'd1');
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ entity_type: 'dashboard', op: 'upsert' });
  });

  it('report create lands a reference_change_log row', async () => {
    const db = await makeMigratedDb();
    const reportDefs = createReportStore(db, referenceCapture); // bootstrap construction
    await reportDefs.create({
      id: 'r1', name: 'AMR', description: '', category: 'amr', designId: 'd1', primaryQueryId: 'q1',
      summaryMetrics: null, chart: null, paramOptions: null, status: 'published',
    });
    const log = await refLog(db, 'r1');
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ entity_type: 'report', op: 'upsert' });
  });

  it('publishing a form lands a reference_change_log row', async () => {
    const db = await makeMigratedDb();
    const forms = createFormStore(db, referenceCapture); // bootstrap construction
    const created = await forms.create({ name: 'Intake', schema: { name: 'Intake', fields: [], sections: [] } as never, targetPages: ['forms'] });
    await forms.publish(created.id);
    const log = await refLog(db, created.id);
    expect(log.length).toBeGreaterThanOrEqual(1);
    expect(log.at(-1)).toMatchObject({ entity_type: 'form', op: 'upsert' });
  });
});

/**
 * RBAC Task 4: `createAppContext` seeds the 5 system roles UNCONDITIONALLY (via
 * `roles.seedSystemRoles()` beside `const roles = createRoleStore(internal.db)` in index.ts) —
 * deliberately NOT gated behind SEED_ON_START, which defaults to false and only guards optional
 * demo/sample data (see seed.ts). `createAppContext` itself can't run against pg-mem (real pg
 * pools + a LISTEN client, per the comment above), so this mirrors the exact bootstrap
 * construction (`createRoleStore(internal.db)`) against a fully-migrated db, the same pattern the
 * reference-capture tests above use, and proves the seed call's idempotent semantics: 5 roles
 * after one call, still 5 after a second (both fresh install and an existing-DB upgrade re-run it
 * on every boot).
 */
describe('createAppContext system-role seed (RBAC Task 4)', () => {
  it('seedSystemRoles produces the 5 system roles, idempotently', async () => {
    const db = await makeMigratedDb();
    const roles = createRoleStore(db); // bootstrap construction: createRoleStore(internal.db)
    await roles.seedSystemRoles();
    await roles.seedSystemRoles(); // second call (mirrors every-boot re-seed) — no duplicates
    const list = await roles.list();
    expect(list).toHaveLength(5);
    expect(list.map((r) => r.slug).sort()).toEqual(
      ['data_analyst', 'lab_admin', 'lab_manager', 'lab_technician', 'system_auditor'].sort(),
    );
    const admin = list.find((r) => r.slug === 'lab_admin')!;
    expect(admin.isSystem).toBe(true);
    expect(admin.locked).toBe(true);
  });
});

/**
 * Admin-lockout regression guard for `dangerFactoryReset` (packages/bootstrap/src/index.ts): a
 * factory reset TRUNCATEs every internal-DB table — including `roles`/`role_capabilities`/
 * `user_roles` — via `wipeInternalDatabase()`, and `seedDatabase()` deliberately does NOT reseed
 * roles (that seed is routed through `createAppContext`'s unconditional boot-time call — see the
 * comment beside `const roles = createRoleStore(internal.db)` in index.ts). Left unfixed, a live
 * server would be left with zero roles until the process restarts.
 *
 * `dangerFactoryReset` itself can't run against pg-mem end-to-end (it calls `createDbContext`,
 * which opens real pg pools — see the reference-capture describe block above for the same
 * constraint), and `wipeInternalDatabase()`'s own table-discovery query (`pg_tables`) isn't
 * supported by pg-mem either (see danger.test.ts, which for the same reason only unit-tests the
 * pure `buildTruncateSql` SQL builder, never a live wipe). This instead proves the narrower
 * guarantee the fix relies on, using `truncateTables()` — the same CASCADE TRUNCATE statement
 * `wipeInternalDatabase` issues, just against an explicit table list instead of one discovered via
 * `pg_tables` — targeted at exactly the tables a factory reset empties: `roles` really does end up
 * empty, and re-calling `roles.seedSystemRoles()` after the wipe — exactly what `dangerFactoryReset`
 * now does — repopulates all 5 system roles without any process restart.
 */
describe('dangerFactoryReset role reseed (admin-lockout fix)', () => {
  it('truncating roles (as a factory reset would) then re-seeding repopulates the 5 system roles', async () => {
    const db = await makeMigratedDb();
    const roles = createRoleStore(db); // bootstrap construction: createRoleStore(internal.db)

    // Boot-time seed (mirrors createAppContext's unconditional call).
    await roles.seedSystemRoles();
    expect(await roles.list()).toHaveLength(5);

    // Factory reset step 1: wipe. Proves the bug's premise — roles really is emptied. Same CASCADE
    // TRUNCATE `wipeInternalDatabase` runs, just given the table names directly (pg-mem can't run
    // the `pg_tables` query it uses to discover them — see the comment above) and one statement per
    // table (pg-mem also doesn't support a single multi-table TRUNCATE, unlike real Postgres).
    for (const table of ['role_capabilities', 'user_roles', 'roles'] as const) {
      await truncateTables(db, [table]);
    }
    expect(await roles.list()).toHaveLength(0);

    // Factory reset step 2 (the fix): dangerFactoryReset now calls ctx.roles.seedSystemRoles()
    // after the wipe/reseed, using the same already-constructed roles store off ctx (not a
    // fresh one) — so the reset leaves 5 roles present with no restart required.
    await roles.seedSystemRoles();
    const list = await roles.list();
    expect(list).toHaveLength(5);
    expect(list.map((r) => r.slug).sort()).toEqual(
      ['data_analyst', 'lab_admin', 'lab_manager', 'lab_technician', 'system_auditor'].sort(),
    );
    const admin = list.find((r) => r.slug === 'lab_admin')!;
    expect(admin.isSystem).toBe(true);
    expect(admin.locked).toBe(true);
  });
});
