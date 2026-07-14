import { describe, it, expect } from 'vitest';
import { makeMigratedDb } from './migrations/internal/test-helpers';
import { createReferenceApplier } from './reference-apply';

describe('applyReferenceChange', () => {
  it('upserts a dashboard stamped managed_origin=central', async () => {
    const db = await makeMigratedDb();
    const apply = createReferenceApplier(db);
    const body = { id: 'd1', name: 'X', ownerId: null, isDefault: false, refreshIntervalSec: 0, filters: [], widgets: [], layout: [] };
    const r = await apply({ entityType: 'dashboard', entityId: 'd1', op: 'upsert', body });
    expect(r).toBe('applied');
    const row = await db.selectFrom('dashboards').selectAll().where('id', '=', 'd1').executeTakeFirst();
    expect((row as any)?.managed_origin).toBe('central');
    expect((row as any)?.name).toBe('X');
    await db.destroy();
  });

  it('upsert updates an existing central-managed dashboard', async () => {
    const db = await makeMigratedDb();
    const apply = createReferenceApplier(db);
    const base = { id: 'd1', name: 'X', ownerId: null, isDefault: false, refreshIntervalSec: 0, filters: [], widgets: [], layout: [] };
    await apply({ entityType: 'dashboard', entityId: 'd1', op: 'upsert', body: base });
    await apply({ entityType: 'dashboard', entityId: 'd1', op: 'upsert', body: { ...base, name: 'Y' } });
    const row = await db.selectFrom('dashboards').selectAll().where('id', '=', 'd1').executeTakeFirst();
    expect((row as any)?.name).toBe('Y');
    expect((row as any)?.managed_origin).toBe('central');
    await db.destroy();
  });

  it('delete removes a central-managed row but NOT a lab-local one', async () => {
    const db = await makeMigratedDb();
    const apply = createReferenceApplier(db);
    await apply({ entityType: 'dashboard', entityId: 'dc', op: 'upsert', body: { id: 'dc', name: 'C', ownerId: null, isDefault: false, refreshIntervalSec: 0, filters: [], widgets: [], layout: [] } });
    // lab-local row (managed_origin null) — insert directly with the minimal required cols:
    await db.insertInto('dashboards').values({ id: 'dl', name: 'L', owner_id: null, is_default: false, refresh_interval_sec: 0, filters: JSON.stringify([]), widgets: JSON.stringify([]), layout: JSON.stringify([]), managed_origin: null } as never).execute();
    await apply({ entityType: 'dashboard', entityId: 'dc', op: 'delete' });
    await apply({ entityType: 'dashboard', entityId: 'dl', op: 'delete' }); // must be a no-op (lab-local)
    expect(await db.selectFrom('dashboards').select('id').where('id', '=', 'dc').executeTakeFirst()).toBeUndefined();
    expect(await db.selectFrom('dashboards').select('id').where('id', '=', 'dl').executeTakeFirst()).toBeTruthy();
    await db.destroy();
  });

  it('applies a report (upsert stamped central + delete guarded)', async () => {
    const db = await makeMigratedDb();
    const apply = createReferenceApplier(db);
    const body = { id: 'r1', name: 'Rep', description: 'desc', category: 'cat', designId: 'dz', primaryQueryId: 'pq', summaryMetrics: null, chart: null, paramOptions: null, status: 'published' };
    expect(await apply({ entityType: 'report', entityId: 'r1', op: 'upsert', body })).toBe('applied');
    const row = await db.selectFrom('reports').selectAll().where('id', '=', 'r1').executeTakeFirst();
    expect((row as any)?.managed_origin).toBe('central');
    expect((row as any)?.name).toBe('Rep');
    expect((row as any)?.category).toBe('cat');
    // update in place
    await apply({ entityType: 'report', entityId: 'r1', op: 'upsert', body: { ...body, name: 'Rep2', summaryMetrics: [{ a: 1 }] } });
    const row2 = await db.selectFrom('reports').selectAll().where('id', '=', 'r1').executeTakeFirst();
    expect((row2 as any)?.name).toBe('Rep2');
    const sm = (row2 as any).summary_metrics;
    expect(typeof sm === 'string' ? JSON.parse(sm) : sm).toEqual([{ a: 1 }]);
    // delete
    await apply({ entityType: 'report', entityId: 'r1', op: 'delete' });
    expect(await db.selectFrom('reports').select('id').where('id', '=', 'r1').executeTakeFirst()).toBeUndefined();
    await db.destroy();
  });

  it('report delete does NOT remove a lab-local row', async () => {
    const db = await makeMigratedDb();
    const apply = createReferenceApplier(db);
    await db.insertInto('reports').values({ id: 'rl', name: 'L', description: '', category: 'c', design_id: 'd', primary_query_id: 'p', status: 'draft', managed_origin: null } as never).execute();
    await apply({ entityType: 'report', entityId: 'rl', op: 'delete' });
    expect(await db.selectFrom('reports').select('id').where('id', '=', 'rl').executeTakeFirst()).toBeTruthy();
    await db.destroy();
  });

  it('applies a form (upsert stamped central + delete guarded)', async () => {
    const db = await makeMigratedDb();
    const apply = createReferenceApplier(db);
    const body = { id: 'form-1', name: 'Intake', status: 'published', active: true, schema: { fields: [] }, fhirVersion: 'R4', fhirProfileUrl: null, facilityId: 'fac-1' };
    expect(await apply({ entityType: 'form', entityId: 'form-1', op: 'upsert', body })).toBe('applied');
    const row = await db.selectFrom('form_definitions').selectAll().where('id', '=', 'form-1').executeTakeFirst();
    expect((row as any)?.managed_origin).toBe('central');
    expect((row as any)?.name).toBe('Intake');
    expect((row as any)?.facility_id).toBe('fac-1');
    const s = (row as any).schema;
    expect(typeof s === 'string' ? JSON.parse(s) : s).toEqual({ fields: [] });
    // delete guarded: central-managed removed
    await apply({ entityType: 'form', entityId: 'form-1', op: 'delete' });
    expect(await db.selectFrom('form_definitions').select('id').where('id', '=', 'form-1').executeTakeFirst()).toBeUndefined();
    await db.destroy();
  });

  it('form delete does NOT remove a lab-local row', async () => {
    const db = await makeMigratedDb();
    const apply = createReferenceApplier(db);
    await db.insertInto('form_definitions').values({ id: 'form-local', name: 'Local', status: 'published', active: true, schema: JSON.stringify({ fields: [] }), managed_origin: null } as never).execute();
    await apply({ entityType: 'form', entityId: 'form-local', op: 'delete' });
    expect(await db.selectFrom('form_definitions').select('id').where('id', '=', 'form-local').executeTakeFirst()).toBeTruthy();
    await db.destroy();
  });

  it('applies a setting (upsert + delete)', async () => {
    const db = await makeMigratedDb();
    const apply = createReferenceApplier(db);
    await apply({ entityType: 'setting', entityId: 'dashboard.raw_sql', op: 'upsert', body: 'true' });
    expect((await db.selectFrom('app_settings').selectAll().where('key', '=', 'dashboard.raw_sql').executeTakeFirst()) as any).toMatchObject({ value: 'true' });
    // update in place
    await apply({ entityType: 'setting', entityId: 'dashboard.raw_sql', op: 'upsert', body: 'false' });
    expect(((await db.selectFrom('app_settings').select('value').where('key', '=', 'dashboard.raw_sql').executeTakeFirst()) as any)?.value).toBe('false');
    await apply({ entityType: 'setting', entityId: 'dashboard.raw_sql', op: 'delete' });
    expect(await db.selectFrom('app_settings').select('key').where('key', '=', 'dashboard.raw_sql').executeTakeFirst()).toBeUndefined();
    await db.destroy();
  });

  it('rejects an upsert with no body', async () => {
    const db = await makeMigratedDb();
    const apply = createReferenceApplier(db);
    await expect(apply({ entityType: 'report', entityId: 'r1', op: 'upsert' })).rejects.toThrow(/requires body/);
    await db.destroy();
  });
});
