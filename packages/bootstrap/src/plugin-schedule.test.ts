import { describe, it, expect, vi } from 'vitest';
import { createPluginScheduleApi, createPluginScheduleRunner } from './plugin-schedule';
import type { PluginDataStore, PluginDataEntry } from '@openldr/db';

/** In-memory PluginDataStore fake (a Map keyed by `${pluginId}|${collection}|${key}`). */
function fakePluginData(): PluginDataStore & { dump(): Map<string, PluginDataEntry> } {
  const m = new Map<string, { pluginId: string } & PluginDataEntry>();
  const k = (p: string, c: string, key: string) => `${p}|${c}|${key}`;
  return {
    async get(p, c, key) { return m.get(k(p, c, key))?.doc ?? null; },
    async put(p, c, key, doc) { m.set(k(p, c, key), { pluginId: p, collection: c, key, doc, updatedAt: new Date() }); },
    async delete(p, c, key) { m.delete(k(p, c, key)); },
    async list(p, c, opts) {
      let out = [...m.values()].filter((e) => e.pluginId === p && e.collection === c);
      if (opts?.where) out = out.filter((e) => (e.doc as Record<string, unknown>)[opts.where!.field] === opts.where!.eq);
      out = out.sort((a, b) => a.key.localeCompare(b.key));
      if (opts?.limit !== undefined) out = out.slice(0, opts.limit);
      return out.map((e) => ({ collection: e.collection, key: e.key, doc: e.doc, updatedAt: e.updatedAt }));
    },
    async purge(p) { for (const key of [...m.keys()]) if (m.get(key)!.pluginId === p) m.delete(key); },
    dump() { return new Map([...m.entries()].map(([key, v]) => [key, { collection: v.collection, key: v.key, doc: v.doc, updatedAt: v.updatedAt }])); },
  };
}

/** Eventing fake: records published events + exposes the subscribed handlers. */
function fakeEventing() {
  const handlers: Record<string, (e: { type: string; payload: unknown }) => Promise<void>> = {};
  const published: { event: { type: string; payload: unknown }; opts?: { availableAt?: Date } }[] = [];
  return {
    handlers,
    published,
    healthCheck: vi.fn(async () => ({ status: 'up' as const })),
    subscribe: vi.fn(async (type: string, h: (e: { type: string; payload: unknown }) => Promise<void>) => { handlers[type] = h; }),
    publish: vi.fn(async (event: { type: string; payload: unknown }, opts?: { availableAt?: Date }) => { published.push({ event, opts }); }),
  };
}

const PID = 'dhis2-sink';

describe('createPluginScheduleApi', () => {
  it('register mints an id, defaults enabled, stores at plugin_data, returns the doc', async () => {
    const pd = fakePluginData();
    const api = createPluginScheduleApi(pd);
    const stored = (await api.register(PID, { mappingId: 'm1', periodType: 'monthly' })) as Record<string, unknown>;
    expect(stored.id).toEqual(expect.any(String));
    expect(stored.enabled).toBe(true);
    expect(stored.mappingId).toBe('m1');
    expect(await pd.get(PID, 'schedules', stored.id as string)).toMatchObject({ mappingId: 'm1', enabled: true });
  });

  it('honors an explicit id + enabled:false (toggle path upserts by id)', async () => {
    const pd = fakePluginData();
    const api = createPluginScheduleApi(pd);
    await api.register(PID, { id: 'sch1', mappingId: 'm1', enabled: true });
    const off = (await api.register(PID, { id: 'sch1', mappingId: 'm1', enabled: false })) as Record<string, unknown>;
    expect(off.id).toBe('sch1');
    expect(off.enabled).toBe(false);
    const list = (await api.list(PID)) as Record<string, unknown>[];
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: 'sch1', enabled: false });
  });

  it('list returns the docs; remove deletes', async () => {
    const pd = fakePluginData();
    const api = createPluginScheduleApi(pd);
    await api.register(PID, { id: 'a', mappingId: 'm1' });
    await api.register(PID, { id: 'b', mappingId: 'm2' });
    expect((await api.list(PID)) as unknown[]).toHaveLength(2);
    await api.remove(PID, 'a');
    const list = (await api.list(PID)) as Record<string, unknown>[];
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('b');
  });
});

function runnerFixture() {
  const pd = fakePluginData();
  const push = vi.fn(async () => ({ kind: 'aggregate' }));
  const logger = { error: vi.fn() };
  const runner = createPluginScheduleRunner({ pluginData: pd, push, logger });
  return { pd, push, logger, runner };
}

async function seedSchedule(pd: PluginDataStore, over: Record<string, unknown> = {}) {
  await pd.put(PID, 'schedules', 'sch1', {
    id: 'sch1', mappingId: 'm1', mode: 'aggregate', periodType: 'monthly',
    eventDriven: false, enabled: true, lastRunAt: null, nextDueAt: null, ...over,
  });
}

async function seedMapping(pd: PluginDataStore, definition: Record<string, unknown> = { connectorId: 'c1' }) {
  await pd.put(PID, 'mappings', 'm1', { id: 'm1', name: 'Map 1', definition });
}

describe('plugin schedule runner runDue', () => {
  it('runs an enabled schedule: pushes with built orgUnitMap + period + updates lastRunAt', async () => {
    const { pd, push, runner } = runnerFixture();
    await seedSchedule(pd);
    await seedMapping(pd, { connectorId: 'c1', kind: 'aggregate' });
    await pd.put(PID, 'orgUnitMaps', 'f1', { facilityId: 'F1', orgUnitId: 'OU1' });
    await pd.put(PID, 'orgUnitMaps', 'f2', { facilityId: 'F2', orgUnitId: 'OU2' });

    await runner.runDue(PID, 'sch1');

    expect(push).toHaveBeenCalledWith(expect.objectContaining({
      connectorId: 'c1',
      mapping: { connectorId: 'c1', kind: 'aggregate' },
      orgUnitMap: { F1: 'OU1', F2: 'OU2' },
      period: expect.any(String),
      dryRun: false,
      trigger: 'scheduled',
    }));
    const doc = (await pd.get(PID, 'schedules', 'sch1')) as Record<string, unknown>;
    expect(doc.lastRunAt).toEqual(expect.any(String));
  });

  it('disabled schedule → no push', async () => {
    const { pd, push, runner } = runnerFixture();
    await seedSchedule(pd, { enabled: false });
    await seedMapping(pd);
    await runner.runDue(PID, 'sch1');
    expect(push).not.toHaveBeenCalled();
  });

  it('missing schedule → no push, no throw', async () => {
    const { push, runner } = runnerFixture();
    await expect(runner.runDue(PID, 'nope')).resolves.toBeUndefined();
    expect(push).not.toHaveBeenCalled();
  });

  it('missing mapping → no push but does not throw (still updates lastRunAt)', async () => {
    const { pd, push, logger, runner } = runnerFixture();
    await seedSchedule(pd); // no mapping seeded
    await expect(runner.runDue(PID, 'sch1')).resolves.toBeUndefined();
    expect(push).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalled();
    const doc = (await pd.get(PID, 'schedules', 'sch1')) as Record<string, unknown>;
    expect(doc.lastRunAt).toEqual(expect.any(String));
  });

  it('mapping without connectorId → no push (logs), still updates lastRunAt', async () => {
    const { pd, push, logger, runner } = runnerFixture();
    await seedSchedule(pd);
    await seedMapping(pd, { kind: 'aggregate' }); // no connectorId
    await runner.runDue(PID, 'sch1');
    expect(push).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalled();
    const doc = (await pd.get(PID, 'schedules', 'sch1')) as Record<string, unknown>;
    expect(doc.lastRunAt).toEqual(expect.any(String));
  });

  it('push throwing → caught (no rethrow), lastRunAt still updated', async () => {
    const { pd, push, logger, runner } = runnerFixture();
    await seedSchedule(pd);
    await seedMapping(pd);
    push.mockRejectedValueOnce(new Error('boom'));
    await expect(runner.runDue(PID, 'sch1')).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalled();
    const doc = (await pd.get(PID, 'schedules', 'sch1')) as Record<string, unknown>;
    expect(doc.lastRunAt).toEqual(expect.any(String));
  });
});

describe('plugin schedule runner registerRunner', () => {
  it('subscribes to plugin.schedule.due; firing runs + re-arms with a future availableAt', async () => {
    const { pd, push, runner } = runnerFixture();
    await seedSchedule(pd);
    await seedMapping(pd);
    const eventing = fakeEventing();
    await runner.registerRunner(eventing as never);
    expect(eventing.subscribe).toHaveBeenCalledWith('plugin.schedule.due', expect.any(Function));

    await eventing.handlers['plugin.schedule.due']!({ type: 'plugin.schedule.due', payload: { pluginId: PID, scheduleId: 'sch1' } });

    expect(push).toHaveBeenCalledTimes(1);
    expect(eventing.published).toHaveLength(1);
    expect(eventing.published[0].event).toEqual({ type: 'plugin.schedule.due', payload: { pluginId: PID, scheduleId: 'sch1' } });
    expect(eventing.published[0].opts?.availableAt).toBeInstanceOf(Date);
    expect(eventing.published[0].opts!.availableAt!.getTime()).toBeGreaterThan(Date.now());
    const doc = (await pd.get(PID, 'schedules', 'sch1')) as Record<string, unknown>;
    expect(doc.nextDueAt).toEqual(expect.any(String));
  });

  it('a schedule disabled mid-run is not re-armed', async () => {
    const { pd, push, runner } = runnerFixture();
    await seedSchedule(pd);
    await seedMapping(pd);
    // push side effect: disable the schedule mid-run (simulates a concurrent toggle).
    push.mockImplementationOnce(async () => {
      await pd.put(PID, 'schedules', 'sch1', { id: 'sch1', mappingId: 'm1', periodType: 'monthly', enabled: false, lastRunAt: null, nextDueAt: null });
      return { kind: 'aggregate' };
    });
    const eventing = fakeEventing();
    await runner.registerRunner(eventing as never);
    await eventing.handlers['plugin.schedule.due']!({ type: 'plugin.schedule.due', payload: { pluginId: PID, scheduleId: 'sch1' } });
    expect(eventing.publish).not.toHaveBeenCalled();
    // The anti-crash-loop RMW still ran even on the disable path.
    const doc = (await pd.get(PID, 'schedules', 'sch1')) as Record<string, unknown>;
    expect(doc.lastRunAt).toEqual(expect.any(String));
  });

  it('firing for a no-longer-existing schedule is a no-op', async () => {
    const { push, runner } = runnerFixture();
    const eventing = fakeEventing();
    await runner.registerRunner(eventing as never);
    await eventing.handlers['plugin.schedule.due']!({ type: 'plugin.schedule.due', payload: { pluginId: PID, scheduleId: 'gone' } });
    expect(push).not.toHaveBeenCalled();
    expect(eventing.publish).not.toHaveBeenCalled();
  });
});

describe('plugin schedule runner reconcile', () => {
  it('arms an enabled schedule with no nextDueAt (publishes + writes nextDueAt)', async () => {
    const { pd, runner } = runnerFixture();
    await seedSchedule(pd, { nextDueAt: null });
    const eventing = fakeEventing();
    await runner.reconcile(eventing as never);
    expect(eventing.publish).toHaveBeenCalledWith(
      { type: 'plugin.schedule.due', payload: { pluginId: PID, scheduleId: 'sch1' } },
      expect.objectContaining({ availableAt: expect.any(Date) }),
    );
    const doc = (await pd.get(PID, 'schedules', 'sch1')) as Record<string, unknown>;
    expect(doc.nextDueAt).toEqual(expect.any(String));
  });

  it('arms an overdue schedule (past nextDueAt) using the past due', async () => {
    const { pd, runner } = runnerFixture();
    const past = new Date(Date.now() - 60_000).toISOString();
    await seedSchedule(pd, { nextDueAt: past });
    const eventing = fakeEventing();
    await runner.reconcile(eventing as never);
    expect(eventing.published).toHaveLength(1);
    expect(eventing.published[0].opts!.availableAt!.toISOString()).toBe(past);
  });

  it('skips a schedule already armed in the future', async () => {
    const { pd, runner } = runnerFixture();
    await seedSchedule(pd, { nextDueAt: new Date(Date.now() + 86_400_000).toISOString() });
    const eventing = fakeEventing();
    await runner.reconcile(eventing as never);
    expect(eventing.publish).not.toHaveBeenCalled();
  });

  it('skips disabled schedules', async () => {
    const { pd, runner } = runnerFixture();
    await seedSchedule(pd, { enabled: false, nextDueAt: null });
    const eventing = fakeEventing();
    await runner.reconcile(eventing as never);
    expect(eventing.publish).not.toHaveBeenCalled();
  });
});
