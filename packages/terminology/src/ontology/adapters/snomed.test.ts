import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { snomedAdapter } from './snomed';
import { ROOT_CODE, type IndexWriter } from '../types';

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
});
