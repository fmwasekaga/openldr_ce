import { describe, it, expect, vi } from 'vitest';
import type { SyncQuarantineRow } from '@openldr/db';
import { createRetryQuarantine } from './sync-retry-quarantine';

const DESC = { url: 'http://x', version: '2.1', kind: 'CodeSystem', resourceId: 'cs-7', generation: 4 };

const row = (over: Partial<SyncQuarantineRow> = {}): SyncQuarantineRow => ({
  entityType: 'terminology_system',
  entityId: 'http://x',
  attempts: 3,
  status: 'quarantined',
  lastError: 'boom',
  lastSeq: 9,
  lastBody: DESC,
  firstFailedAt: new Date('2026-07-14T08:00:00.000Z'),
  updatedAt: new Date('2026-07-14T09:00:00.000Z'),
  quarantinedAt: new Date('2026-07-14T09:00:00.000Z'),
  ...over,
});

function fakes(stored: SyncQuarantineRow | undefined) {
  const quarantine = {
    get: vi.fn(async () => stored),
    clear: vi.fn(async () => {}),
    recordFailure: vi.fn(async () => ({ attempts: 4, status: 'quarantined' as const })),
    list: vi.fn(async () => []),
  };
  const termBulk = { syncSystem: vi.fn(async () => {}), syncConceptMap: vi.fn(async () => {}) };
  return { quarantine, termBulk };
}

describe('createRetryQuarantine', () => {
  it('REFUSES an entity with no quarantine row — writes nothing', async () => {
    // An operator can hand the endpoint/CLI any string (they only check non-empty). Without this guard a
    // retry of a HEALTHY system would reconcile with an empty descriptor and stamp
    // version:null / resource_id:'' / generation:0 over good metadata.
    const { quarantine, termBulk } = fakes(undefined);
    const retry = createRetryQuarantine({ quarantine, termBulk, threshold: 3 });

    const res = await retry('terminology_system', 'http://healthy');
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not quarantined/);
    expect(termBulk.syncSystem).not.toHaveBeenCalled();
    expect(termBulk.syncConceptMap).not.toHaveBeenCalled();
    expect(quarantine.clear).not.toHaveBeenCalled();
    expect(quarantine.recordFailure).not.toHaveBeenCalled();
  });

  it('replays the stored descriptor and clears the row on success', async () => {
    const { quarantine, termBulk } = fakes(row());
    const retry = createRetryQuarantine({ quarantine, termBulk, threshold: 3 });

    expect(await retry('terminology_system', 'http://x')).toEqual({ ok: true });
    // FIX 1: central's REAL descriptor is replayed, not undefined.
    expect(termBulk.syncSystem).toHaveBeenCalledWith('http://x', DESC);
    expect(quarantine.clear).toHaveBeenCalledWith('terminology_system', 'http://x');
    expect(quarantine.recordFailure).not.toHaveBeenCalled();
  });

  it('routes a concept_map to syncConceptMap with its stored descriptor', async () => {
    const stored = row({ entityType: 'concept_map', entityId: 'http://m', lastBody: { mapUrl: 'http://m', generation: 2 } });
    const { quarantine, termBulk } = fakes(stored);
    const retry = createRetryQuarantine({ quarantine, termBulk, threshold: 3 });

    expect(await retry('concept_map', 'http://m')).toEqual({ ok: true });
    expect(termBulk.syncConceptMap).toHaveBeenCalledWith('http://m', { mapUrl: 'http://m', generation: 2 });
    expect(termBulk.syncSystem).not.toHaveBeenCalled();
  });

  it('a failed re-sync does NOT clear the row and re-records from the real history', async () => {
    // FIX 4: clearing first would lose visibility on a crash; re-recording from scratch would reset
    // attempts to 1 / seq 0 and discard first_failed_at / quarantined_at.
    const { quarantine, termBulk } = fakes(row());
    termBulk.syncSystem.mockRejectedValueOnce(new Error('still malformed'));
    const retry = createRetryQuarantine({ quarantine, termBulk, threshold: 3 });

    expect(await retry('terminology_system', 'http://x')).toEqual({ ok: false, error: 'still malformed' });
    expect(quarantine.clear).not.toHaveBeenCalled(); // the row survives for the operator
    expect(quarantine.recordFailure).toHaveBeenCalledWith('terminology_system', 'http://x', {
      seq: 9, // carried from the row, not reset to 0
      error: 'still malformed',
      body: DESC, // the descriptor is preserved for the next retry
      threshold: 3,
    });
  });

  it('refuses a non-bulk entity type even if a row somehow exists', async () => {
    const { quarantine, termBulk } = fakes(row({ entityType: 'form', entityId: 'f1' }));
    const retry = createRetryQuarantine({ quarantine, termBulk, threshold: 3 });

    const res = await retry('form', 'f1');
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not a retriable bulk entity type/);
    expect(termBulk.syncSystem).not.toHaveBeenCalled();
    expect(quarantine.clear).not.toHaveBeenCalled();
  });
});
