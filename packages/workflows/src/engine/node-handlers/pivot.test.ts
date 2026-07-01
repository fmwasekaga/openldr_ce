import { describe, it, expect } from 'vitest';
import { pivotHandler } from './pivot';
import { createContext } from '../execution-context';

const node = (cfg: Record<string, unknown>) => ({ id: 'p1', type: 'action', data: { action: 'pivot', config: cfg } });
const ctx = createContext(undefined, () => {});

describe('pivotHandler', () => {
  const input = [
    { json: { requestid: 'R1', organism: 'E.coli', drug: 'Amikacin', val: 'S', ward: 'A' } },
    { json: { requestid: 'R1', organism: 'E.coli', drug: 'Ampicillin', val: 'R', ward: 'A' } },
    { json: { requestid: 'R2', organism: 'S.aureus', drug: 'Amikacin', val: 'I', ward: 'B' } },
  ];

  it('pivots long rows into one wide row per group with fixed columns', async () => {
    const out = await pivotHandler(node({
      groupBy: ['requestid', 'organism'], pivotColumn: 'drug', valueColumn: 'val',
      columns: ['Amikacin', 'Ampicillin', 'Ceftriaxone'], carry: ['ward'],
    }), ctx, input);
    expect(out).toHaveLength(2);
    expect(out[0].json).toEqual({ requestid: 'R1', organism: 'E.coli', ward: 'A', Amikacin: 'S', Ampicillin: 'R', Ceftriaxone: '' });
    expect(out[1].json).toEqual({ requestid: 'R2', organism: 'S.aureus', ward: 'B', Amikacin: 'I', Ampicillin: '', Ceftriaxone: '' });
  });

  it('MAX-aggregates collisions within a group', async () => {
    const dup = [
      { json: { requestid: 'R1', organism: 'E.coli', drug: 'Amikacin', val: 'R' } },
      { json: { requestid: 'R1', organism: 'E.coli', drug: 'Amikacin', val: 'S' } },
    ];
    const out = await pivotHandler(node({ groupBy: ['requestid', 'organism'], pivotColumn: 'drug', valueColumn: 'val', columns: ['Amikacin'], aggregate: 'max' }), ctx, dup);
    expect(out[0].json.Amikacin).toBe('S');
  });

  it('returns [] for empty input', async () => {
    expect(await pivotHandler(node({ groupBy: ['requestid'], pivotColumn: 'drug', valueColumn: 'val', columns: [] }), ctx, [])).toEqual([]);
  });
});
