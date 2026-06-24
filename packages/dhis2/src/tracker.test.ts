import { describe, it, expect } from 'vitest';
import { validateTrackerMapping } from './tracker';
import type { TrackerMapping } from './types';
import type { TargetMetadata } from '@openldr/ports';

const mapping: TrackerMapping = {
  kind: 'tracker', id: 'amr-events', name: 'AMR events',
  source: { kind: 'event-source', sourceId: 'amr-isolates' },
  program: 'PR1', programStage: 'PS1',
  orgUnitColumn: 'facility', eventDateColumn: 'eventDate', idColumn: 'id',
  dataValues: [{ column: 'antibiotic', dataElement: 'DE_AB' }, { column: 'result', dataElement: 'DE_RES' }],
};

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
