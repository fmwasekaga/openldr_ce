import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { rxnormAdapter } from './rxnorm';
import { ROOT_CODE, type IndexWriter } from '../types';

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
});
