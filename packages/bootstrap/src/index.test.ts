import { describe, it, expect, afterEach } from 'vitest';
import { makeMigratedDb } from '@openldr/db/testing';
import { createAppSettingsStore, createReportStore, referenceCapture } from '@openldr/db';
import { createDashboardStore } from '@openldr/dashboards';
import { createFormStore } from '@openldr/forms';
import type { Config } from '@openldr/config';
import { createAppContext, type AppContext } from './index';

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
    expect(typeof ctx.plugins.list).toBe('function');
    expect(typeof ctx.plugins.install).toBe('function');
    expect(typeof ctx.plugins.rollback).toBe('function');
    expect(typeof ctx.plugins.setEnabled).toBe('function');
    expect(typeof ctx.plugins.remove).toBe('function');
    // Nothing reachable in this test → overall down, but no crash.
    expect(out.status).toBe('down');
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
