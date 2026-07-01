import { describe, it, expect, vi } from 'vitest';
import { seedDatabase, type FormSeedTarget } from './seed';
import type { DbContext } from './db-context';

// In-memory fakes so we exercise the real seedDatabase logic without a database.
function fakeApp(cfg: FormSeedTarget['cfg'] = {}) {
  const forms: { id: string; name: string; status: string }[] = [];
  const workflows: { id: string; name: string }[] = [];
  const connectors: { id: string; name: string; type: string | null; config: Record<string, string> }[] = [];
  const app: FormSeedTarget = {
    forms: {
      list: async () => forms as never,
      create: async (f: { name: string; status?: string }) => {
        const created = { id: `form-${forms.length}`, name: f.name, status: f.status ?? 'draft' };
        forms.push(created);
        return created as never;
      },
      setStatus: async (id: string, status: string) => {
        const f = forms.find((x) => x.id === id);
        if (f) f.status = status;
        return f as never;
      },
    },
    workflows: {
      store: {
        list: async () => workflows as never,
        create: async (w: { id: string; name: string }) => {
          workflows.push({ id: w.id, name: w.name });
          return w as never;
        },
      },
    },
    connectors: {
      list: async () => connectors as never,
      create: async (input: { id: string; name: string; type?: string | null; config: Record<string, string> }) => {
        connectors.push({ id: input.id, name: input.name, type: input.type ?? null, config: input.config });
      },
    },
    cfg,
  };
  return { app, workflows, connectors };
}

const fakeDb = { persist: vi.fn(async (r: { id: string }) => ({ flattened: JSON.stringify(r) })) } as unknown as DbContext;

describe('seedDatabase — sample workflow', () => {
  it('seeds the sample workflow once', async () => {
    const { app, workflows } = fakeApp();
    const res = await seedDatabase(fakeDb, app);
    expect(res.workflowsSeeded).toBe(1);
    expect(workflows.filter((w) => w.id === 'wf-sample')).toHaveLength(1);
    expect(workflows[0].name).toBe('Sample Workflow');
  });

  it('is idempotent — re-running does not duplicate it', async () => {
    const { app, workflows } = fakeApp();
    await seedDatabase(fakeDb, app);
    const res2 = await seedDatabase(fakeDb, app);
    expect(res2.workflowsSeeded).toBe(0);
    expect(workflows.filter((w) => w.id === 'wf-sample')).toHaveLength(1);
  });
});

describe('seedDatabase — default connector', () => {
  const cfg = { SECRETS_ENCRYPTION_KEY: 'k', TARGET_DATABASE_URL: 'postgres://openldr:pw@warehouse:5433/openldr_target' };

  it('creates a postgres/database connector parsed from TARGET_DATABASE_URL', async () => {
    const { app, connectors } = fakeApp(cfg);
    const res = await seedDatabase(fakeDb, app);
    expect(res.connectorsSeeded).toBe(1);
    expect(connectors).toHaveLength(1);
    const c = connectors[0];
    expect(c.name).toBe('Target Warehouse (Postgres)');
    expect(c.type).toBe('postgres');
    expect(c.config).toEqual({ host: 'warehouse', port: '5433', user: 'openldr', password: 'pw', database: 'openldr_target', ssl: 'false' });
  });

  it('is idempotent by name — re-running does not duplicate it', async () => {
    const { app, connectors } = fakeApp(cfg);
    await seedDatabase(fakeDb, app);
    const res2 = await seedDatabase(fakeDb, app);
    expect(res2.connectorsSeeded).toBe(0);
    expect(connectors).toHaveLength(1);
  });

  it('skips (and does not throw) when SECRETS_ENCRYPTION_KEY is unset', async () => {
    const { app, connectors } = fakeApp({ TARGET_DATABASE_URL: cfg.TARGET_DATABASE_URL });
    const res = await seedDatabase(fakeDb, app);
    expect(res.connectorsSeeded).toBe(0);
    expect(connectors).toHaveLength(0);
  });

  it('skips when TARGET_DATABASE_URL is unset', async () => {
    const { app, connectors } = fakeApp({ SECRETS_ENCRYPTION_KEY: 'k' });
    const res = await seedDatabase(fakeDb, app);
    expect(res.connectorsSeeded).toBe(0);
    expect(connectors).toHaveLength(0);
  });
});
