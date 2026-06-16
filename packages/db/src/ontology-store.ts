import { type Kysely, sql } from 'kysely';
import type { InternalSchema } from './schema/internal';

const ROOT_CODE = '__ROOT__';

export interface OntoNode {
  code: string;
  display: string;
  kind: string;
  extra: Record<string, unknown> | null;
  childCount: number;
  group: string | null;
}

export interface OntoBreadcrumb {
  code: string;
  display: string;
}

export interface OntoDistribution {
  codingSystemId: string;
  ontologyType: string;
  sourcePath: string;
  indexStatus: string;
  indexError: string | null;
  nodeCount: number | null;
  edgeCount: number | null;
  manifest: unknown | null;
  builtAt: string | null;
  updatedAt: string;
}

export interface OntoNodeInput {
  code: string;
  display: string;
  kind: string | null;
  extra: Record<string, unknown> | null;
}

export interface OntoEdgeInput {
  parent: string;
  child: string;
  seq: number;
  label: string | null;
}

export interface OntoPanelMemberInput {
  panelLoinc: string;
  memberLoinc: string;
  memberName: string;
  displayName: string;
  sequence: number;
  required: boolean;
}

export interface OntoAnswerInput {
  loinc: string;
  seq: number;
  value: string;
  label: string;
}

export interface OntoSpecimenInput {
  loinc: string;
  snomedCode: string;
  equivalence: string;
}

function parseJsonObject(value: unknown): Record<string, unknown> | null {
  if (value == null) return null;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  return value as Record<string, unknown>;
}

function parseManifest(value: unknown): unknown | null {
  if (value == null) return null;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as unknown;
    } catch {
      return null;
    }
  }
  return value;
}

export function createOntologyStore(db: Kysely<InternalSchema>) {
  async function childCounts(systemId: string, codes: string[]): Promise<Map<string, number>> {
    if (codes.length === 0) return new Map();
    const rows = await db
      .selectFrom('ontology_edges')
      .select((eb) => ['parent_code', eb.fn.countAll<number>().as('n')])
      .where('coding_system_id', '=', systemId)
      .where('parent_code', 'in', codes)
      .groupBy('parent_code')
      .execute();
    return new Map(rows.map((row) => [row.parent_code, Number(row.n)]));
  }

  async function children(systemId: string, parentCode: string): Promise<OntoNode[]> {
    const rows = await db
      .selectFrom('ontology_edges as e')
      .innerJoin('ontology_nodes as n', (join) =>
        join.onRef('n.code', '=', 'e.child_code').onRef('n.coding_system_id', '=', 'e.coding_system_id'),
      )
      .select(['n.code', 'n.display', 'n.kind', 'n.extra', 'e.label as group', 'e.seq'])
      .where('e.coding_system_id', '=', systemId)
      .where('e.parent_code', '=', parentCode)
      .orderBy('e.seq')
      .orderBy('n.display')
      .execute();
    const counts = await childCounts(systemId, rows.map((row) => row.code));
    return rows.map((row) => ({
      code: row.code,
      display: row.display,
      kind: row.kind ?? '',
      extra: parseJsonObject(row.extra),
      childCount: counts.get(row.code) ?? 0,
      group: row.group ?? null,
    }));
  }

  async function node(systemId: string, code: string): Promise<OntoNode | null> {
    const row = await db
      .selectFrom('ontology_nodes')
      .selectAll()
      .where('coding_system_id', '=', systemId)
      .where('code', '=', code)
      .executeTakeFirst();
    if (!row) return null;
    const counts = await childCounts(systemId, [code]);
    return {
      code: row.code,
      display: row.display,
      kind: row.kind ?? '',
      extra: parseJsonObject(row.extra),
      childCount: counts.get(code) ?? 0,
      group: null,
    };
  }

  function distRow(row: {
    coding_system_id: string;
    ontology_type: string;
    source_path: string;
    index_status: string;
    index_error: string | null;
    node_count: number | null;
    edge_count: number | null;
    manifest: unknown;
    built_at: string | null;
    updated_at: string;
  }): OntoDistribution {
    return {
      codingSystemId: row.coding_system_id,
      ontologyType: row.ontology_type,
      sourcePath: row.source_path,
      indexStatus: row.index_status,
      indexError: row.index_error,
      nodeCount: row.node_count,
      edgeCount: row.edge_count,
      manifest: parseManifest(row.manifest),
      builtAt: row.built_at,
      updatedAt: row.updated_at,
    };
  }

  async function upsertDist(
    systemId: string,
    fields: {
      ontology_type: string;
      source_path: string;
      index_status?: string;
      index_error?: string | null;
      node_count?: number | null;
      edge_count?: number | null;
      manifest?: unknown | null;
      built_at?: string | null;
    },
  ): Promise<void> {
    await db
      .insertInto('ontology_distributions')
      .values({
        coding_system_id: systemId,
        ontology_type: fields.ontology_type,
        source_path: fields.source_path,
        index_status: fields.index_status ?? 'none',
        index_error: fields.index_error ?? null,
        node_count: fields.node_count ?? null,
        edge_count: fields.edge_count ?? null,
        manifest: fields.manifest != null ? (JSON.stringify(fields.manifest) as never) : null,
        built_at: fields.built_at ?? null,
        updated_at: sql`now()`,
      } as never)
      .onConflict((oc) =>
        oc.column('coding_system_id').doUpdateSet((eb) => ({
          ontology_type: eb.ref('excluded.ontology_type'),
          source_path: eb.ref('excluded.source_path'),
          index_status: eb.ref('excluded.index_status'),
          index_error: eb.ref('excluded.index_error'),
          node_count: eb.ref('excluded.node_count'),
          edge_count: eb.ref('excluded.edge_count'),
          manifest: eb.ref('excluded.manifest'),
          built_at: eb.ref('excluded.built_at'),
          updated_at: sql`now()`,
        })),
      )
      .execute();
  }

  async function clearIndex(systemId: string): Promise<void> {
    await db.deleteFrom('ontology_specimen_map').where('coding_system_id', '=', systemId).execute();
    await db.deleteFrom('ontology_answer_options').where('coding_system_id', '=', systemId).execute();
    await db.deleteFrom('ontology_panel_members').where('coding_system_id', '=', systemId).execute();
    await db.deleteFrom('ontology_edges').where('coding_system_id', '=', systemId).execute();
    await db.deleteFrom('ontology_nodes').where('coding_system_id', '=', systemId).execute();
  }

  return {
    async list(): Promise<OntoDistribution[]> {
      return (await db.selectFrom('ontology_distributions').selectAll().execute()).map(distRow);
    },

    async get(systemId: string): Promise<OntoDistribution | null> {
      const row = await db
        .selectFrom('ontology_distributions')
        .selectAll()
        .where('coding_system_id', '=', systemId)
        .executeTakeFirst();
      return row ? distRow(row) : null;
    },

    async beginBuild(systemId: string, ontologyType: string, sourcePath: string): Promise<void> {
      await upsertDist(systemId, { ontology_type: ontologyType, source_path: sourcePath, index_status: 'building', index_error: null });
    },

    async finishBuild(
      systemId: string,
      opts: { ontologyType: string; sourcePath: string; nodeCount: number; edgeCount: number; manifest: unknown },
    ): Promise<void> {
      await upsertDist(systemId, {
        ontology_type: opts.ontologyType,
        source_path: opts.sourcePath,
        index_status: 'ready',
        index_error: null,
        node_count: opts.nodeCount,
        edge_count: opts.edgeCount,
        manifest: opts.manifest,
        built_at: new Date().toISOString(),
      });
    },

    async failBuild(systemId: string, ontologyType: string, sourcePath: string, error: string): Promise<void> {
      await upsertDist(systemId, {
        ontology_type: ontologyType,
        source_path: sourcePath,
        index_status: 'error',
        index_error: error,
      });
    },

    clearIndex,

    async unlink(systemId: string): Promise<void> {
      await clearIndex(systemId);
      await db.deleteFrom('ontology_distributions').where('coding_system_id', '=', systemId).execute();
    },

    async bulkInsertNodes(systemId: string, rows: OntoNodeInput[]): Promise<void> {
      if (!rows.length) return;
      await db
        .insertInto('ontology_nodes')
        .values(
          rows.map((row) => ({
            coding_system_id: systemId,
            code: row.code,
            display: row.display,
            kind: row.kind,
            extra: row.extra != null ? (JSON.stringify(row.extra) as never) : null,
          })) as never,
        )
        .onConflict((oc) =>
          oc.columns(['coding_system_id', 'code']).doUpdateSet((eb) => ({
            display: eb.ref('excluded.display'),
            kind: eb.ref('excluded.kind'),
            extra: eb.ref('excluded.extra'),
          })),
        )
        .execute();
    },

    async bulkInsertEdges(systemId: string, rows: OntoEdgeInput[]): Promise<void> {
      if (!rows.length) return;
      await db
        .insertInto('ontology_edges')
        .values(
          rows.map((row) => ({
            coding_system_id: systemId,
            parent_code: row.parent,
            child_code: row.child,
            seq: row.seq,
            label: row.label,
          })) as never,
        )
        .execute();
    },

    async bulkInsertPanelMembers(systemId: string, rows: OntoPanelMemberInput[]): Promise<void> {
      if (!rows.length) return;
      await db
        .insertInto('ontology_panel_members')
        .values(
          rows.map((member) => ({
            coding_system_id: systemId,
            panel_loinc: member.panelLoinc,
            member_loinc: member.memberLoinc,
            member_name: member.memberName,
            display_name: member.displayName,
            sequence: member.sequence,
            required: member.required,
          })) as never,
        )
        .execute();
    },

    async bulkInsertAnswerOptions(systemId: string, rows: OntoAnswerInput[]): Promise<void> {
      if (!rows.length) return;
      await db
        .insertInto('ontology_answer_options')
        .values(
          rows.map((answer) => ({
            coding_system_id: systemId,
            loinc: answer.loinc,
            seq: answer.seq,
            value: answer.value,
            label: answer.label,
          })) as never,
        )
        .execute();
    },

    async bulkInsertSpecimens(systemId: string, rows: OntoSpecimenInput[]): Promise<void> {
      if (!rows.length) return;
      await db
        .insertInto('ontology_specimen_map')
        .values(
          rows.map((map) => ({
            coding_system_id: systemId,
            loinc: map.loinc,
            snomed_code: map.snomedCode,
            equivalence: map.equivalence,
          })) as never,
        )
        .execute();
    },

    roots: (systemId: string) => children(systemId, ROOT_CODE),
    children,
    node,

    async search(systemId: string, query: string, limit = 50): Promise<OntoNode[]> {
      const q = query.trim();
      if (!q) return [];
      const like = `%${q.toLowerCase()}%`;
      const rows = await db
        .selectFrom('ontology_nodes')
        .select(['code', 'display', 'kind', 'extra'])
        .where('coding_system_id', '=', systemId)
        .where((eb) => eb.or([eb(sql`lower(display)`, 'like', like), eb(sql`lower(code)`, 'like', like)]))
        .orderBy('display')
        .limit(limit)
        .execute();
      const counts = await childCounts(systemId, rows.map((row) => row.code));
      return rows.map((row) => ({
        code: row.code,
        display: row.display,
        kind: row.kind ?? '',
        extra: parseJsonObject(row.extra),
        childCount: counts.get(row.code) ?? 0,
        group: null,
      }));
    },

    async path(systemId: string, code: string): Promise<OntoBreadcrumb[]> {
      const out: OntoBreadcrumb[] = [];
      const seen = new Set<string>();
      let current: string | null = code;
      while (current && current !== ROOT_CODE && !seen.has(current)) {
        seen.add(current);
        const currentNode = await db
          .selectFrom('ontology_nodes')
          .select(['code', 'display'])
          .where('coding_system_id', '=', systemId)
          .where('code', '=', current)
          .executeTakeFirst();
        if (currentNode) out.unshift({ code: currentNode.code, display: currentNode.display });
        const parent = await db
          .selectFrom('ontology_edges')
          .select(['parent_code'])
          .where('coding_system_id', '=', systemId)
          .where('child_code', '=', current)
          .orderBy('seq')
          .limit(1)
          .executeTakeFirst();
        current = parent?.parent_code ?? null;
      }
      return out;
    },

    async panelMembers(systemId: string, panelLoinc: string): Promise<OntoPanelMemberInput[]> {
      const rows = await db
        .selectFrom('ontology_panel_members')
        .selectAll()
        .where('coding_system_id', '=', systemId)
        .where('panel_loinc', '=', panelLoinc)
        .orderBy('sequence')
        .orderBy('member_loinc')
        .execute();
      return rows.map((row) => ({
        panelLoinc: row.panel_loinc,
        memberLoinc: row.member_loinc,
        memberName: row.member_name,
        displayName: row.display_name,
        sequence: row.sequence,
        required: row.required,
      }));
    },

    async answerOptions(systemId: string, loinc: string): Promise<Array<{ value: string; label: string }>> {
      const rows = await db
        .selectFrom('ontology_answer_options')
        .select(['value', 'label'])
        .where('coding_system_id', '=', systemId)
        .where('loinc', '=', loinc)
        .orderBy('seq')
        .execute();
      return rows.map((row) => ({ value: row.value, label: row.label }));
    },

    async specimenCodes(systemId: string, loinc: string): Promise<Array<{ snomedCode: string; equivalence: string }>> {
      const rows = await db
        .selectFrom('ontology_specimen_map')
        .select(['snomed_code', 'equivalence'])
        .where('coding_system_id', '=', systemId)
        .where('loinc', '=', loinc)
        .execute();
      return rows.map((row) => ({ snomedCode: row.snomed_code, equivalence: row.equivalence }));
    },
  };
}

export type OntologyStore = ReturnType<typeof createOntologyStore>;
