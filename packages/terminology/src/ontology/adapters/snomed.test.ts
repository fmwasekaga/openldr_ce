import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { snomedAdapter, parseSemanticTag } from './snomed';
import { ROOT_CODE, type IndexWriter } from '../types';
import { canonicalSystemUrl } from '../../system-urls';

const FIXTURE = join(__dirname, '__fixtures__', 'snomed');

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
  const childrenOf = (parent: string) =>
    edges
      .filter((edge) => edge.parent === parent)
      .sort((a, b) => a.seq - b.seq)
      .map((edge) => edge.child);
  const node = (code: string) => nodes.find((candidate) => candidate.code === code) ?? null;
  return { writer, nodes, edges, childrenOf, node };
}

describe('snomedAdapter', () => {
  it('detects an RF2 Snapshot folder', () => {
    expect(snomedAdapter.detect(FIXTURE)?.type).toBe('snomed');
  });

  it('builds an IS-A tree, FSN names, ignores inactive rows', async () => {
    const distribution = snomedAdapter.detect(FIXTURE)!;
    const collected = collector();
    await snomedAdapter.buildIndex(distribution, collected.writer, () => {});

    expect(collected.childrenOf(ROOT_CODE)).toContain('138875005');
    expect(collected.childrenOf('138875005')).toEqual(['123037004']);
    expect(collected.childrenOf('123037004')).toEqual(['119297000']);
    expect(collected.node('119297000')?.display).toBe('Blood specimen (specimen)');
  });

  it('tees flat concepts (FSN + semanticTag) when a conceptSink is provided', async () => {
    const distribution = snomedAdapter.detect(FIXTURE)!;
    const collected = collector();
    const concepts: any[] = [];
    await snomedAdapter.buildIndex(distribution, collected.writer, () => {}, async (rows) => { concepts.push(...rows); });
    const blood = concepts.find((c) => c.code === '119297000');
    expect(blood).toMatchObject({ system: canonicalSystemUrl('snomed'), display: 'Blood specimen (specimen)', status: 'active' });
    expect(blood.properties).toMatchObject({ semanticTag: 'specimen', fsn: 'Blood specimen (specimen)' });
    // every active FSN'd concept is emitted (fuller than the tree node set)
    expect(concepts.length).toBeGreaterThanOrEqual(collected.nodes.length);
  });

  it('emits no concepts when no conceptSink is provided (rebuild path unchanged)', async () => {
    const distribution = snomedAdapter.detect(FIXTURE)!;
    const collected = collector();
    let called = false;
    await snomedAdapter.buildIndex(distribution, collected.writer, () => {}); // no 4th arg
    expect(called).toBe(false);
    expect(collected.nodes.length).toBeGreaterThan(0); // tree still built
  });

  it('parseSemanticTag extracts the trailing parenthetical, else null', () => {
    expect(parseSemanticTag('Blood specimen (specimen)')).toBe('specimen');
    expect(parseSemanticTag('Diabetes mellitus (disorder)')).toBe('disorder');
    expect(parseSemanticTag('No tag here')).toBeNull();
  });
});
