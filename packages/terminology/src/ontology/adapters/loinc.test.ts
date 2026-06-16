import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { loincAdapter } from './loinc';
import { ROOT_CODE, type IndexWriter } from '../types';

const FIXTURE = join(__dirname, '__fixtures__', 'loinc');

function collector() {
  const nodes: { code: string; display: string; kind: string | null; extra: Record<string, unknown> | null }[] = [];
  const edges: { parent: string; child: string; seq: number; label: string | null }[] = [];
  const panels: {
    panelLoinc: string;
    memberLoinc: string;
    memberName: string;
    displayName: string;
    sequence: number;
    required: boolean;
  }[] = [];
  const answers: { loinc: string; seq: number; value: string; label: string }[] = [];
  const specimens: { loinc: string; snomedCode: string; equivalence: string }[] = [];
  const writer: IndexWriter = {
    insertNode: (node) => nodes.push(node),
    insertEdge: (parent, child, seq, label = null) => edges.push({ parent, child, seq, label }),
    insertPanelMember: (member) => panels.push(member),
    insertAnswerOption: (answer) => answers.push(answer),
    insertSpecimenMap: (map) => specimens.push(map),
  };
  const childrenOf = (parent: string) =>
    edges
      .filter((edge) => edge.parent === parent)
      .sort((a, b) => a.seq - b.seq)
      .map((edge) => edge.child);
  const node = (code: string) => nodes.find((candidate) => candidate.code === code) ?? null;
  return { writer, nodes, edges, panels, answers, specimens, childrenOf, node };
}

describe('loincAdapter', () => {
  it('detects a folder containing ComponentHierarchyBySystem.csv', () => {
    const distribution = loincAdapter.detect(FIXTURE);
    expect(distribution?.type).toBe('loinc');
    expect(distribution?.fileStats.length).toBe(6);
  });

  it('returns null for an unrelated folder', () => {
    expect(loincAdapter.detect(join(__dirname, '__fixtures__'))).toBeNull();
  });

  it('builds the multiaxial hierarchy under ROOT', () => {
    const distribution = loincAdapter.detect(FIXTURE)!;
    const collected = collector();
    loincAdapter.buildIndex(distribution, collected.writer, () => {});

    expect(collected.childrenOf(ROOT_CODE)).toEqual(['LP432695-7']);
    expect(collected.node('LP432695-7')?.kind).toBe('category');
    expect(collected.childrenOf('LP432695-7')).toEqual(['LP29693-6']);
    expect(collected.childrenOf('LP29693-6')).toEqual(['LP343406-7']);
    expect(collected.childrenOf('LP343406-7')).toEqual(['2093-3', '2571-8']);
    expect(collected.node('2093-3')?.kind).toBe('term');
    expect(collected.node('2093-3')?.display).toBe('Cholesterol [Mass/Vol]');
  });

  it('parses panels, answers, and SNOMED specimen maps', () => {
    const distribution = loincAdapter.detect(FIXTURE)!;
    const collected = collector();
    loincAdapter.buildIndex(distribution, collected.writer, () => {});

    expect(collected.panels.filter((member) => member.panelLoinc === '24331-1').map((member) => member.memberLoinc)).toEqual([
      '2093-3',
      '2571-8',
    ]);
    expect(collected.panels[0]).toMatchObject({ displayName: 'Cholesterol', required: true, sequence: 1 });
    expect(
      collected.answers
        .filter((answer) => answer.loinc === '32789-0')
        .sort((a, b) => a.seq - b.seq)
        .map((answer) => answer.value),
    ).toEqual(['LA2', 'LA1']);
    expect(collected.specimens.filter((specimen) => specimen.loinc === '6429-5').map((specimen) => specimen.snomedCode)).toEqual([
      '119297000',
      '122555007',
    ]);
  });
});
