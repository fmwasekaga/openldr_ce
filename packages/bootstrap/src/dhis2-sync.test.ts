import { describe, it, expect, vi } from 'vitest';
import type { EventEnvelope, EventHandler, EventingPort, PublishOptions } from '@openldr/ports';

function fakeEventing() {
  const handlers = new Map<string, EventHandler>();
  const published: { event: EventEnvelope; opts?: PublishOptions }[] = [];
  const bus: Pick<EventingPort, 'subscribe' | 'publish'> = {
    async subscribe(type, h) { handlers.set(type, h); },
    async publish(event, opts) { published.push({ event, opts }); },
  };
  return { bus, handlers, published };
}

describe('dhis2 sync handler logic', () => {
  it('re-enqueues after success and after failure, and skips disabled', async () => {
    const schedules = {
      records: new Map<string, { id: string; enabled: boolean }>([
        ['ok', { id: 'ok', enabled: true }],
        ['off', { id: 'off', enabled: false }],
      ]),
      get(id: string) { return Promise.resolve(this.records.get(id) ?? null); },
      markRun() { return Promise.resolve(); },
    };
    const runMapping = vi.fn(async () => undefined as never);
    const { bus, handlers, published } = fakeEventing();

    await bus.subscribe('dhis2.sync.due', async (event) => {
      const { scheduleId } = event.payload as { scheduleId: string };
      const sched = await schedules.get(scheduleId);
      if (!sched || !sched.enabled) return;
      try { await runMapping(); } catch { /* still reschedule */ }
      await schedules.markRun();
      await bus.publish({ type: 'dhis2.sync.due', payload: { scheduleId } }, { availableAt: new Date(Date.now() + 1000) });
    });

    const fire = handlers.get('dhis2.sync.due')!;
    await fire({ type: 'dhis2.sync.due', payload: { scheduleId: 'ok' } });
    expect(runMapping).toHaveBeenCalledTimes(1);
    expect(published).toHaveLength(1);

    runMapping.mockRejectedValueOnce(new Error('dhis2 down'));
    await fire({ type: 'dhis2.sync.due', payload: { scheduleId: 'ok' } });
    expect(published).toHaveLength(2); // re-enqueued even after failure

    await fire({ type: 'dhis2.sync.due', payload: { scheduleId: 'off' } });
    expect(published).toHaveLength(2); // disabled → no re-enqueue
  });
});
