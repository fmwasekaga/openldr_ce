import type { Kysely } from 'kysely';
import type { InternalSchema } from '@openldr/db';
import { type Workflow, WorkflowSchema } from './types';

function toRow(w: Workflow) {
  return {
    id: w.id,
    name: w.name,
    description: w.description ?? null,
    definition: JSON.stringify(w.definition),
    enabled: w.enabled,
    created_by: w.createdBy ?? null,
  };
}

function fromRow(r: Record<string, unknown>): Workflow {
  const parse = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : (v ?? { nodes: [], edges: [] }));
  return WorkflowSchema.parse({
    id: r.id,
    name: r.name,
    description: r.description ?? null,
    definition: parse(r.definition),
    enabled: r.enabled == null ? true : Boolean(r.enabled),
    createdBy: r.created_by ?? null,
    createdAt: r.created_at ? String(r.created_at) : undefined,
    updatedAt: r.updated_at ? String(r.updated_at) : undefined,
  });
}

export interface WorkflowStore {
  list(): Promise<Workflow[]>;
  get(id: string): Promise<Workflow | undefined>;
  create(w: Workflow): Promise<Workflow>;
  update(id: string, w: Workflow): Promise<Workflow>;
  remove(id: string): Promise<void>;
}

export function createWorkflowStore(db: Kysely<InternalSchema>): WorkflowStore {
  const t = () => db.selectFrom('workflows');
  const store: WorkflowStore = {
    async list() {
      const rows = await t().selectAll().orderBy('name').execute();
      return rows.map((r) => fromRow(r as Record<string, unknown>));
    },
    async get(id) {
      const r = await t().selectAll().where('id', '=', id).executeTakeFirst();
      return r ? fromRow(r as Record<string, unknown>) : undefined;
    },
    async create(w) {
      await db.insertInto('workflows').values(toRow(WorkflowSchema.parse(w)) as never).execute();
      return (await store.get(w.id))!;
    },
    async update(id, w) {
      await db.updateTable('workflows').set({ ...toRow(WorkflowSchema.parse({ ...w, id })) } as never).where('id', '=', id).execute();
      return (await store.get(id))!;
    },
    async remove(id) {
      await db.deleteFrom('workflows').where('id', '=', id).execute();
    },
  };
  return store;
}
