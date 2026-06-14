import { describe, it, expect } from 'vitest';
import { buildEvents, validateTrackerMapping } from './tracker';
import type { TrackerMapping } from './types';
import type { TargetMetadata } from '@openldr/ports';

const mapping: TrackerMapping = {
  kind: 'tracker', id: 'amr-events', name: 'AMR events',
  source: { kind: 'event-source', sourceId: 'amr-isolates' },
  program: 'PR1', programStage: 'PS1',
  orgUnitColumn: 'facility', eventDateColumn: 'eventDate', idColumn: 'id',
  dataValues: [{ column: 'antibiotic', dataElement: 'DE_AB' }, { column: 'result', dataElement: 'DE_RES' }],
};
const orgMap = new Map([['fac-1', 'OU_AAA']]);

describe('buildEvents', () => {
  it('builds one event per row with a deterministic uid', () => {
    const rows = [{ id: 'obs-1', facility: 'fac-1', eventDate: '2026-01-10', antibiotic: 'AMP', result: 'R' }];
    const { payload, skipped } = buildEvents(rows, mapping, orgMap);
    expect(skipped).toEqual([]);
    expect(payload.events).toHaveLength(1);
    expect(payload.events[0]).toMatchObject({ program: 'PR1', programStage: 'PS1', orgUnit: 'OU_AAA', occurredAt: '2026-01-10' });
    expect(payload.events[0].event).toMatch(/^[A-Za-z][A-Za-z0-9]{10}$/);
    expect(payload.events[0].dataValues).toEqual([{ dataElement: 'DE_AB', value: 'AMP' }, { dataElement: 'DE_RES', value: 'R' }]);
  });
  it('skips rows with no orgUnit mapping', () => {
    const { payload, skipped } = buildEvents([{ id: 'o', facility: 'nope', eventDate: '2026-01-10' }], mapping, orgMap);
    expect(payload.events).toEqual([]);
    expect(skipped[0].reason).toMatch(/orgUnit/i);
  });
  it('skips rows missing eventDate or id', () => {
    expect(buildEvents([{ id: 'o', facility: 'fac-1' }], mapping, orgMap).skipped[0].reason).toMatch(/eventDate/i);
    expect(buildEvents([{ facility: 'fac-1', eventDate: '2026-01-10' }], mapping, orgMap).skipped[0].reason).toMatch(/idColumn/i);
  });
  it('omits empty dataValues but keeps the event', () => {
    const rows = [{ id: 'obs-2', facility: 'fac-1', eventDate: '2026-01-10', antibiotic: 'CIP', result: null }];
    expect(buildEvents(rows, mapping, orgMap).payload.events[0].dataValues).toEqual([{ dataElement: 'DE_AB', value: 'CIP' }]);
  });
});

describe('validateTrackerMapping', () => {
  const metadata: TargetMetadata = {
    dataElements: [{ id: 'DE_AB', name: 'ab' }, { id: 'DE_RES', name: 'res' }],
    orgUnits: [], categoryOptionCombos: [],
    programs: [{ id: 'PR1', name: 'p' }], programStages: [{ id: 'PS1', name: 's', program: 'PR1' }],
  };
  it('passes when program/stage/dataElements exist', () => expect(validateTrackerMapping(mapping, metadata)).toEqual([]));
  it('flags unknown program', () => expect(validateTrackerMapping({ ...mapping, program: 'X' }, metadata).some((p) => p.includes('X'))).toBe(true));
  it('flags unknown dataElement', () => expect(validateTrackerMapping({ ...mapping, dataValues: [{ column: 'c', dataElement: 'DE_NO' }] }, metadata).some((p) => p.includes('DE_NO'))).toBe(true));
});
