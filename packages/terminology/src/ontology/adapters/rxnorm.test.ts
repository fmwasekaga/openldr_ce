import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { rxnormAdapter } from './rxnorm';
import { ROOT_CODE, type IndexWriter } from '../types';
import { canonicalSystemUrl } from '../../system-urls';

const FIXTURE = join(__dirname, '__fixtures__', 'rxnorm');

function collector() {
  const nodes: { code: string; display: string; kind: string | null; extra: Record<string, unknown> | null }[] = [];
  const edges: { parent: string; child: string; seq: number; label: string | null }[] = [];
  const writer: IndexWriter = {
    insertNode: (node) => nodes.push(node),
    insertEdge: (parent, child, seq, label = null) => edges.push({ parent, child, seq, label }),
    insertPanelMember: () => {},
    insertAnswerOption: () => {},
    insertSpecimenMap: () => {},
  };
  const node = (code: string) => nodes.find((candidate) => candidate.code === code) ?? null;
  const childrenOf = (parent: string) =>
    edges
      .filter((edge) => edge.parent === parent)
      .sort((a, b) => {
        if (a.seq !== b.seq) return a.seq - b.seq;
        return (node(a.child)?.display ?? a.child).localeCompare(node(b.child)?.display ?? b.child);
      })
      .map((edge) => {
        const child = node(edge.child);
        return child ? { ...child, group: edge.label } : null;
      })
      .filter((child): child is NonNullable<typeof child> => child != null);
  const codes = (parent: string, group: string): string[] => childrenOf(parent).filter((child) => child.group === group).map((child) => child.code);
  return { writer, nodes, edges, childrenOf, codes };
}

describe('rxnormAdapter two-layer', () => {
  it('detects an rrf folder', () => {
    expect(rxnormAdapter.detect(FIXTURE)?.type).toBe('rxnorm');
  });

  it('builds ATC spine, bridges to the ingredient, and 2-hop grouped edges (Fluconazole)', async () => {
    const distribution = rxnormAdapter.detect(FIXTURE)!;
    const collected = collector();
    await rxnormAdapter.buildIndex(distribution, collected.writer, () => {});

    expect(collected.childrenOf(ROOT_CODE).map((node) => node.code)).toContain('J');
    expect(collected.childrenOf('J').map((node) => node.code)).toContain('J02');
    expect(collected.childrenOf('J02AC').map((node) => node.code)).toContain('J02AC01');

    const bridged = collected.childrenOf('J02AC01');
    expect(bridged.map((node) => node.code)).toContain('4450');
    expect(bridged.find((node) => node.code === '4450')!.group).toBe('Ingredients');

    expect(collected.codes('4450', 'Clinical drugs')).toEqual(['197698']);
    expect(collected.codes('4450', 'Brand names')).toEqual(['203150']);

    expect(collected.codes('197698', 'Strength components')).toEqual(['315936']);
    expect(collected.codes('197698', 'Ingredients')).toEqual(['4450']);
    expect(collected.codes('197698', 'Branded versions')).toEqual(['216325']);
    const sbd = collected.childrenOf('197698').find((node) => node.code === '216325')!;
    expect(sbd.display).toContain('[Diflucan]');

    expect(collected.codes('216325', 'Generic equivalent')).toEqual(['197698']);
  });

  it('tees flat concepts for semantic-TTY drugs only when a conceptSink is provided', async () => {
    const distribution = rxnormAdapter.detect(FIXTURE)!;
    const collected = collector();
    const concepts: any[] = [];
    await rxnormAdapter.buildIndex(distribution, collected.writer, () => {}, async (rows) => { concepts.push(...rows); });

    expect(concepts.length).toBeGreaterThan(0);
    for (const c of concepts) {
      expect(c.system).toBe(canonicalSystemUrl('rxnorm'));
      expect(c.status).toBe('active');
      expect(c.properties.tty).toBeTruthy(); // only semantic TTYs
      expect(typeof c.display).toBe('string');
    }

    // Every RXNORM semantic-TTY atom in the fixture is emitted, keyed by RXCUI.
    const codes = concepts.map((c) => c.code).sort();
    expect(codes).toEqual(['197698', '203150', '216325', '315936', '317541', '4450']);
    const fluconazole = concepts.find((c) => c.code === '4450');
    expect(fluconazole).toMatchObject({ display: 'fluconazole', properties: { tty: 'IN' } });

    // ATC classification codes (the spine, not drugs) live in atcNames/atcLeafToIngredient,
    // never in `concepts` — so none of the fixture's ATC codes appear here.
    const atcCodesInFixture = ['J02AC01', 'J02AC', 'J02A', 'J02', 'J'];
    for (const atcCode of atcCodesInFixture) {
      expect(codes).not.toContain(atcCode);
    }
  });

  it('emits no concepts when no conceptSink is provided (rebuild path unchanged)', async () => {
    const distribution = rxnormAdapter.detect(FIXTURE)!;
    const collected = collector();
    await rxnormAdapter.buildIndex(distribution, collected.writer, () => {}); // no 4th arg
    expect(collected.nodes.length).toBeGreaterThan(0); // tree still built
  });
});
