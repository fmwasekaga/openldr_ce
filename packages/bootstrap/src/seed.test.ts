import { describe, it, expect, vi } from 'vitest';
import { seedDatabase, type FormSeedTarget } from './seed';
import type { DbContext } from './db-context';

// In-memory fakes so we exercise the real seedDatabase logic without a database.
function fakeApp() {
  const forms: { id: string; name: string; status: string }[] = [];
  const workflows: { id: string; name: string }[] = [];
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
  };
  return { app, workflows };
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
