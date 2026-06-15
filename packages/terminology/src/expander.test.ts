import { describe, it, expect } from 'vitest';
import { expandCompose, type ExpandDeps, type VsCompose } from './expander';

function makeDeps(opts?: { sets?: Record<string, VsCompose> }): ExpandDeps {
  const concepts: Record<string, { code: string; display: string; status: string; class?: string }[]> = {
    's1': [
      { code: 'A', display: 'Alpha', status: 'ACTIVE', class: 'X' },
      { code: 'B', display: 'Beta', status: 'ACTIVE', class: 'Y' },
      { code: 'C', display: 'Gamma', status: 'DRAFT', class: 'X' },
    ],
    's2': [{ code: 'Z', display: 'Zeta', status: 'ACTIVE' }],
  };
  const sets = opts?.sets ?? {};
  return {
    async listSystemConcepts(sys, activeOnly) {
      return (concepts[sys] ?? []).filter((c) => !activeOnly || c.status === 'ACTIVE')
        .map((c) => ({ system: sys, code: c.code, display: c.display }));
    },
    async filterConcepts(sys, filters, activeOnly) {
      return (concepts[sys] ?? []).filter((c) => {
        if (activeOnly && c.status !== 'ACTIVE') return false;
        return filters.every((f) => {
          const v = f.property === 'class' ? c.class : f.property === 'status' ? c.status : undefined;
          return v === f.value;
        });
      }).map((c) => ({ system: sys, code: c.code, display: c.display }));
    },
    async resolveDisplay(sys, code) {
      return (concepts[sys] ?? []).find((c) => c.code === code)?.display ?? null;
    },
    async resolveValueSetCompose(url) {
      return sets[url] ?? null;
    },
  };
}

describe('expandCompose', () => {
  it('expands enumerated concepts (display resolved when omitted)', async () => {
    const { codes } = await expandCompose({ include: [{ system: 's1', concept: [{ code: 'A' }, { code: 'B', display: 'Custom' }] }] }, makeDeps());
    expect(codes).toEqual([
      { system: 's1', code: 'A', display: 'Alpha' },
      { system: 's1', code: 'B', display: 'Custom' },
    ]);
  });

  it('expands a whole system (activeOnly drops DRAFT)', async () => {
    const { codes } = await expandCompose({ include: [{ system: 's1' }] }, makeDeps());
    expect(codes.map((c) => c.code)).toEqual(['A', 'B']);
  });

  it('applies a class filter', async () => {
    const { codes } = await expandCompose({ include: [{ system: 's1', filter: [{ property: 'class', op: '=', value: 'X' }] }] }, makeDeps());
    expect(codes.map((c) => c.code)).toEqual(['A']);
  });

  it('unions across includes and subtracts excludes', async () => {
    const { codes } = await expandCompose({
      include: [{ system: 's1' }, { system: 's2' }],
      exclude: [{ system: 's1', concept: [{ code: 'B' }] }],
    }, makeDeps());
    expect(codes.map((c) => `${c.system}|${c.code}`)).toEqual(['s1|A', 's2|Z']);
  });

  it('intersects dimensions within one clause (concept and filter)', async () => {
    const { codes } = await expandCompose({
      include: [{ system: 's1', concept: [{ code: 'A' }, { code: 'B' }], filter: [{ property: 'class', op: '=', value: 'X' }] }],
    }, makeDeps());
    expect(codes.map((c) => c.code)).toEqual(['A']);
  });

  it('imports another value set and guards cycles', async () => {
    const deps = makeDeps({ sets: { 'urn:child': { include: [{ system: 's2' }] }, 'urn:loop': { include: [{ valueSet: ['urn:loop'] }] } } });
    const imported = await expandCompose({ include: [{ valueSet: ['urn:child'] }] }, deps, { seedUrls: ['urn:root'] });
    expect(imported.codes.map((c) => c.code)).toEqual(['Z']);
    const looped = await expandCompose({ include: [{ valueSet: ['urn:loop'] }] }, deps, { seedUrls: ['urn:loop'] });
    expect(looped.codes).toEqual([]);
  });

  it('dedups by (system, code)', async () => {
    const { codes, total } = await expandCompose({ include: [{ system: 's2' }, { system: 's2' }] }, makeDeps());
    expect(total).toBe(1);
    expect(codes).toHaveLength(1);
  });
});
