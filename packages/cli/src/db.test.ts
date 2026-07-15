import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  dbCtx: { pendingMigrations: vi.fn(), migrateAll: vi.fn(), close: vi.fn() },
  appCtx: { close: vi.fn() },
  createDbContext: vi.fn(),
  createAppContext: vi.fn(),
  seedDatabase: vi.fn(),
}));

vi.mock('@openldr/config', () => ({
  loadConfig: vi.fn(() => ({ config: true })),
}));

vi.mock('@openldr/bootstrap', () => ({
  createDbContext: mocks.createDbContext,
  createAppContext: mocks.createAppContext,
  seedDatabase: mocks.seedDatabase,
}));

import { runDbSeed, runDbMigrate } from './db';

const SEED_RESULT = {
  resources: ['a', 'b', 'c'],
  formsSeeded: 0,
  workflowsSeeded: 0,
  connectorsSeeded: 0,
  dashboardsSeeded: 0,
  settingsSeeded: 0,
  terminology: { valueSetsImported: 0, ucumConceptsImported: 0 },
};

describe('db seed pending-migration guard', () => {
  let out: string;

  beforeEach(() => {
    vi.clearAllMocks();
    out = '';
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      out += String(chunk);
      return true;
    });
    mocks.createDbContext.mockResolvedValue(mocks.dbCtx);
    mocks.createAppContext.mockResolvedValue(mocks.appCtx);
    mocks.seedDatabase.mockResolvedValue(SEED_RESULT);
    mocks.dbCtx.pendingMigrations.mockResolvedValue({ internal: [], external: [] });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('refuses to seed when migrations are pending and never builds the app context', async () => {
    mocks.dbCtx.pendingMigrations.mockResolvedValue({
      internal: ['053_workflow_secrets', '054_sync_amendments'],
      external: ['008_patients_merge'],
    });

    const code = await runDbSeed({ json: false });

    expect(code).toBe(1);
    expect(mocks.seedDatabase).not.toHaveBeenCalled();
    // The crux: createAppContext boots the SEC-06 secret shim, whose failure against a stale
    // schema is the stack trace that buried the real problem. The guard must precede it.
    expect(mocks.createAppContext).not.toHaveBeenCalled();
  });

  it('names the pending migrations and the remedy', async () => {
    mocks.dbCtx.pendingMigrations.mockResolvedValue({
      internal: ['053_workflow_secrets'],
      external: ['008_patients_merge'],
    });

    await runDbSeed({ json: false });

    expect(out).toContain('053_workflow_secrets');
    expect(out).toContain('008_patients_merge');
    expect(out).toContain('db migrate');
  });

  it('closes the db context when it refuses', async () => {
    mocks.dbCtx.pendingMigrations.mockResolvedValue({ internal: ['053_workflow_secrets'], external: [] });

    await runDbSeed({ json: false });

    expect(mocks.dbCtx.close).toHaveBeenCalled();
  });

  it('reports the pending_migrations shape as JSON', async () => {
    mocks.dbCtx.pendingMigrations.mockResolvedValue({ internal: ['053_workflow_secrets'], external: [] });

    await runDbSeed({ json: true });

    expect(JSON.parse(out)).toEqual({
      ok: false,
      error: 'pending_migrations',
      pending: { internal: ['053_workflow_secrets'], external: [] },
    });
  });

  it('seeds normally when the schema is up to date', async () => {
    const code = await runDbSeed({ json: false });

    expect(code).toBe(0);
    expect(mocks.seedDatabase).toHaveBeenCalledOnce();
    expect(out).toContain('seeded 3 resources');
    expect(mocks.dbCtx.close).toHaveBeenCalled();
    expect(mocks.appCtx.close).toHaveBeenCalled();
  });
});

describe('db migrate error reporting', () => {
  let out: string;

  const ok = { results: [], error: undefined };

  beforeEach(() => {
    vi.clearAllMocks();
    out = '';
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      out += String(chunk);
      return true;
    });
    mocks.createDbContext.mockResolvedValue(mocks.dbCtx);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('surfaces the internal migration error instead of a bare "migration error"', async () => {
    mocks.dbCtx.migrateAll.mockResolvedValue({
      internal: { results: [], error: new Error('corrupted migrations: previously executed migration 055_sync_quarantine is missing') },
      external: ok,
    });

    const code = await runDbMigrate({ json: false });

    expect(code).toBe(1);
    expect(out).toContain('corrupted migrations');
    expect(out).toContain('055_sync_quarantine');
    expect(out).toContain('internal');
  });

  it('names the failing side when the external migrations fail', async () => {
    mocks.dbCtx.migrateAll.mockResolvedValue({
      internal: ok,
      external: { results: [], error: new Error('relation "patients" already exists') },
    });

    await runDbMigrate({ json: false });

    expect(out).toContain('external');
    expect(out).toContain('relation "patients" already exists');
  });

  it('redacts credentials echoed by a driver error', async () => {
    mocks.dbCtx.migrateAll.mockResolvedValue({
      internal: { results: [], error: new Error('connect failed: postgres://openldr:hunter2@localhost:5433/openldr') },
      external: ok,
    });

    await runDbMigrate({ json: false });

    expect(out).not.toContain('hunter2');
    expect(out).toContain('***');
  });

  it('reports migration_failed with per-side detail as JSON', async () => {
    mocks.dbCtx.migrateAll.mockResolvedValue({
      internal: { results: [], error: new Error('boom') },
      external: ok,
    });

    await runDbMigrate({ json: true });

    const payload = JSON.parse(out);
    expect(payload.ok).toBe(false);
    expect(payload.error).toBe('migration_failed');
    expect(payload.internalError).toBe('boom');
    expect(payload.externalError).toBeUndefined();
  });

  it('reports the applied migrations on success', async () => {
    mocks.dbCtx.migrateAll.mockResolvedValue({
      internal: { results: [{ migrationName: '055_sync_quarantine' }], error: undefined },
      external: ok,
    });

    const code = await runDbMigrate({ json: false });

    expect(code).toBe(0);
    expect(out).toContain('055_sync_quarantine');
    expect(mocks.dbCtx.close).toHaveBeenCalled();
  });
});
