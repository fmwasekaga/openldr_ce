import { describe, expect, it } from 'vitest';
import { makeMigratedDb } from './test-helpers';

describe('015_ontology', () => {
  it('creates ontology index tables', async () => {
    const db = await makeMigratedDb();

    await db
      .insertInto('ontology_distributions')
      .values({
        coding_system_id: 'loinc',
        ontology_type: 'loinc',
        source_path: 'D:\\ontology\\loinc',
        index_status: 'ready',
        node_count: 2,
        edge_count: 1,
        manifest: JSON.stringify({ schemaVersion: 1 }),
      } as never)
      .execute();

    await db
      .insertInto('ontology_nodes')
      .values({
        coding_system_id: 'loinc',
        code: '__ROOT__',
        display: 'LOINC',
        kind: 'root',
        extra: JSON.stringify({ source: 'fixture' }),
      } as never)
      .execute();

    await db
      .insertInto('ontology_nodes')
      .values({
        coding_system_id: 'loinc',
        code: '2093-3',
        display: 'Cholesterol [Mass/Vol]',
        kind: 'term',
        extra: null,
      } as never)
      .execute();

    await db
      .insertInto('ontology_edges')
      .values({
        coding_system_id: 'loinc',
        parent_code: '__ROOT__',
        child_code: '2093-3',
        seq: 1,
        label: null,
      } as never)
      .execute();

    await db
      .insertInto('ontology_panel_members')
      .values({
        coding_system_id: 'loinc',
        panel_loinc: '24331-1',
        member_loinc: '2093-3',
        member_name: 'Cholesterol',
        display_name: 'Cholesterol [Mass/Vol]',
        sequence: 1,
        required: true,
      } as never)
      .execute();

    await db
      .insertInto('ontology_answer_options')
      .values({
        coding_system_id: 'loinc',
        loinc: '32789-0',
        seq: 1,
        value: 'LA1',
        label: 'Detected',
      } as never)
      .execute();

    await db
      .insertInto('ontology_specimen_map')
      .values({
        coding_system_id: 'loinc',
        loinc: '6429-5',
        snomed_code: '119297000',
        equivalence: 'equivalent',
      } as never)
      .execute();

    const distribution = await db
      .selectFrom('ontology_distributions')
      .select(['ontology_type', 'index_status', 'node_count', 'edge_count'])
      .where('coding_system_id', '=', 'loinc')
      .executeTakeFirstOrThrow();
    expect(distribution).toMatchObject({
      ontology_type: 'loinc',
      index_status: 'ready',
      node_count: 2,
      edge_count: 1,
    });

    const children = await db
      .selectFrom('ontology_edges')
      .select(['child_code'])
      .where('coding_system_id', '=', 'loinc')
      .where('parent_code', '=', '__ROOT__')
      .execute();
    expect(children.map((c) => c.child_code)).toEqual(['2093-3']);

    const panel = await db
      .selectFrom('ontology_panel_members')
      .select(['member_loinc', 'required'])
      .where('coding_system_id', '=', 'loinc')
      .where('panel_loinc', '=', '24331-1')
      .executeTakeFirstOrThrow();
    expect(panel).toMatchObject({ member_loinc: '2093-3', required: true });

    await db.destroy();
  });
});
