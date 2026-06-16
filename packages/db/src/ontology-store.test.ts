import { describe, expect, it } from 'vitest';
import { makeMigratedDb } from './migrations/internal/test-helpers';
import { createOntologyStore } from './ontology-store';

describe('ontology-store', () => {
  it('bulk-inserts nodes/edges and walks roots to children to node', async () => {
    const db = await makeMigratedDb();
    const store = createOntologyStore(db);
    const systemId = 'cs-1';

    await store.bulkInsertNodes(systemId, [
      { code: 'ROOT-A', display: 'Root A', kind: 'category', extra: null },
      { code: 'CHILD-1', display: 'Child One', kind: 'term', extra: null },
    ]);
    await store.bulkInsertEdges(systemId, [
      { parent: '__ROOT__', child: 'ROOT-A', seq: 0, label: null },
      { parent: 'ROOT-A', child: 'CHILD-1', seq: 0, label: null },
    ]);

    const roots = await store.roots(systemId);
    expect(roots.map((node) => node.code)).toEqual(['ROOT-A']);
    expect(roots[0]!.childCount).toBe(1);
    const kids = await store.children(systemId, 'ROOT-A');
    expect(kids.map((node) => node.code)).toEqual(['CHILD-1']);
    expect((await store.node(systemId, 'CHILD-1'))?.display).toBe('Child One');
    expect((await store.search(systemId, 'child')).map((node) => node.code)).toEqual(['CHILD-1']);
    expect((await store.path(systemId, 'CHILD-1')).map((breadcrumb) => breadcrumb.code)).toEqual(['ROOT-A', 'CHILD-1']);

    await db.destroy();
  });

  it('round-trips panel/answer/specimen rows and unlink clears everything', async () => {
    const db = await makeMigratedDb();
    const store = createOntologyStore(db);
    const systemId = 'cs-2';

    await store.beginBuild(systemId, 'loinc', '/tmp/loinc');
    await store.bulkInsertNodes(systemId, [{ code: 'X', display: 'X', kind: 'term', extra: null }]);
    await store.bulkInsertPanelMembers(systemId, [
      { panelLoinc: 'P', memberLoinc: 'X', memberName: 'X', displayName: 'X', sequence: 1, required: true },
    ]);
    await store.bulkInsertAnswerOptions(systemId, [{ loinc: 'X', seq: 0, value: 'LA1', label: 'Yes' }]);
    await store.bulkInsertSpecimens(systemId, [{ loinc: 'X', snomedCode: '119297000', equivalence: 'equivalent' }]);
    await store.finishBuild(systemId, {
      ontologyType: 'loinc',
      sourcePath: '/tmp/loinc',
      nodeCount: 1,
      edgeCount: 0,
      manifest: { schemaVersion: 1, fileStats: [] },
    });

    expect((await store.get(systemId))?.indexStatus).toBe('ready');
    expect(await store.panelMembers(systemId, 'P')).toHaveLength(1);
    expect(await store.answerOptions(systemId, 'X')).toEqual([{ value: 'LA1', label: 'Yes' }]);
    expect(await store.specimenCodes(systemId, 'X')).toEqual([{ snomedCode: '119297000', equivalence: 'equivalent' }]);
    await store.unlink(systemId);
    expect(await store.get(systemId)).toBeNull();
    expect(await store.node(systemId, 'X')).toBeNull();

    await db.destroy();
  });
});
