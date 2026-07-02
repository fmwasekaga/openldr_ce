import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendCrashMarker, buildCrashMarker, drainCrashMarkers, type CrashMarker } from '@openldr/core';
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
      fingerprint: 'fp-worker-died',
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
    expect(e.metadata).toMatchObject({
      kind: 'uncaughtException',
      error: 'worker died',
      inFlight: marker.inFlight,
      occurrenceCount: 1,
      firstSeen: marker.at,
      lastSeen: marker.at,
    });
  });

  it('records a system.crash row when no plugin was in flight', async () => {
    appendCrashMarker(dir, { at: 't', kind: 'unhandledRejection', error: 'boom', fingerprint: 'fp-boom', inFlight: [] });
    const { store, recorded } = fakeAudit();
    await drainCrashMarkersToAudit({ dir, audit: store, logger });
    expect(recorded[0].action).toBe('system.crash');
    expect(recorded[0].entityType).toBe('system');
  });

  it('drains the markers (a second drain is a no-op)', async () => {
    appendCrashMarker(dir, { at: 't', kind: 'uncaughtException', error: 'one', fingerprint: 'fp-one', inFlight: [] });
    const { store } = fakeAudit();
    await drainCrashMarkersToAudit({ dir, audit: store, logger });
    expect(drainCrashMarkers(dir)).toEqual([]);
  });

  it('returns 0 and records nothing when there are no markers', async () => {
    const { store, recorded } = fakeAudit();
    expect(await drainCrashMarkersToAudit({ dir, audit: store, logger })).toBe(0);
    expect(recorded).toHaveLength(0);
  });

  it('maps a crash.loop marker to a system.crash_loop row', async () => {
    appendCrashMarker(dir, { at: 't', kind: 'crash.loop', error: 'restart loop', fingerprint: 'fp-loop', inFlight: [] });
    const { store, recorded } = fakeAudit();
    await drainCrashMarkersToAudit({ dir, audit: store, logger });
    expect(recorded[0].action).toBe('system.crash_loop');
    expect(recorded[0].entityType).toBe('system');
    expect(recorded[0].entityId).toBe('process');
  });

  it('coalesces identical-fingerprint markers into one row with a count', async () => {
    // three identical crashes + one distinct
    appendCrashMarker(dir, buildCrashMarker('uncaughtException', new Error('DB pool exhausted')));
    appendCrashMarker(dir, buildCrashMarker('uncaughtException', new Error('DB pool exhausted')));
    appendCrashMarker(dir, buildCrashMarker('uncaughtException', new Error('DB pool exhausted')));
    appendCrashMarker(dir, buildCrashMarker('unhandledRejection', new Error('other')));
    const { store, recorded } = fakeAudit();
    const n = await drainCrashMarkersToAudit({ dir, audit: store, logger });
    expect(n).toBe(4);                    // 4 markers drained
    expect(recorded).toHaveLength(2);     // coalesced into 2 rows
    const pool = recorded.find((r) => (r.metadata as any).error === 'DB pool exhausted');
    expect(pool).toBeDefined();
    expect((pool!.metadata as any).occurrenceCount).toBe(3);
    expect((pool!.metadata as any).firstSeen).toBeDefined();
    expect((pool!.metadata as any).lastSeen).toBeDefined();
  });
});
