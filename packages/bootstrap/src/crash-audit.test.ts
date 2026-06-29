import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendCrashMarker, drainCrashMarkers, type CrashMarker } from '@openldr/core';
import type { AuditEvent, AuditEventInput, AuditStore } from '@openldr/audit';
import { drainCrashMarkersToAudit } from './crash-audit';

let dir: string;

function fakeAudit() {
  const recorded: AuditEventInput[] = [];
  const store: AuditStore = {
    async record(e) { recorded.push(e); return { ...e, id: 'x', occurredAt: 't' } as AuditEvent; },
    async list() { return []; },
    async count() { return 0; },
    async get() { return undefined; },
  };
  return { store, recorded };
}

const logger = { warn() {}, error() {}, info() {} } as any;

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'crashaudit-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('drainCrashMarkersToAudit', () => {
  it('records a plugin.crash row attributed to the in-flight plugin', async () => {
    const marker: CrashMarker = {
      at: '2026-06-29T00:00:00.000Z', kind: 'uncaughtException', error: 'worker died', stack: 'Error: worker died\n  at x',
      inFlight: [{ pluginId: 'dhis2-sink', op: 'invoke', entrypoint: 'push_aggregate', startedAt: '2026-06-29T00:00:00.000Z' }],
    };
    appendCrashMarker(dir, marker);
    const { store, recorded } = fakeAudit();
    const n = await drainCrashMarkersToAudit({ dir, audit: store, logger });
    expect(n).toBe(1);
    expect(recorded).toHaveLength(1);
    const e = recorded[0];
    expect(e.action).toBe('plugin.crash');
    expect(e.entityType).toBe('plugin');
    expect(e.entityId).toBe('dhis2-sink');
    expect(e.actorType).toBe('system');
    expect(e.metadata).toMatchObject({ kind: 'uncaughtException', error: 'worker died', inFlight: marker.inFlight });
  });

  it('records a system.crash row when no plugin was in flight', async () => {
    appendCrashMarker(dir, { at: 't', kind: 'unhandledRejection', error: 'boom', inFlight: [] });
    const { store, recorded } = fakeAudit();
    await drainCrashMarkersToAudit({ dir, audit: store, logger });
    expect(recorded[0].action).toBe('system.crash');
    expect(recorded[0].entityType).toBe('system');
  });

  it('drains the markers (a second drain is a no-op)', async () => {
    appendCrashMarker(dir, { at: 't', kind: 'uncaughtException', error: 'one', inFlight: [] });
    const { store } = fakeAudit();
    await drainCrashMarkersToAudit({ dir, audit: store, logger });
    expect(drainCrashMarkers(dir)).toEqual([]);
  });

  it('returns 0 and records nothing when there are no markers', async () => {
    const { store, recorded } = fakeAudit();
    expect(await drainCrashMarkersToAudit({ dir, audit: store, logger })).toBe(0);
    expect(recorded).toHaveLength(0);
  });
});
