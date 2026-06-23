import { randomUUID } from 'node:crypto';
import type { Kysely } from 'kysely';
import type { InternalSchema } from '@openldr/db';
import { type WorkflowDataset, WorkflowDatasetSchema } from './types';

export interface DatasetInput {
  name: string;
  columns: { key: string; label: string }[];
  rows: Record<string, unknown>[];
  rowCount: number;
  workflowId: string | null;
}

function fromRow(r: Record<string, unknown>): WorkflowDataset {
  const parse = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : (v ?? []));
  return WorkflowDatasetSchema.parse({
    id: r.id, name: r.name, columns: parse(r.columns), rows: parse(r.rows),
    rowCount: Number(r.row_count ?? 0), workflowId: r.workflow_id ?? null,
    publishedTable: r.published_table ?? null,
    createdAt: r.created_at ? String(r.created_at) : undefined,
    updatedAt: r.updated_at ? String(r.updated_at) : undefined,
  });
}

export interface WorkflowDatasetStore {
  upsertByName(d: DatasetInput): Promise<WorkflowDataset>;
  list(): Promise<{ name: string; rowCount: number; workflowId: string | null; updatedAt?: string; publishedTable: string | null }[]>;
  getByName(name: string): Promise<WorkflowDataset | undefined>;
  markPublished(name: string, publishedTable: string): Promise<void>;
}

export function createWorkflowDatasetStore(db: Kysely<InternalSchema>): WorkflowDatasetStore {
  const T = 'workflow_datasets' as const;
  const store: WorkflowDatasetStore = {
    async upsertByName(d) {
      await db.deleteFrom(T).where('name', '=', d.name).execute();
      await db.insertInto(T).values({
        id: randomUUID(), name: d.name, columns: JSON.stringify(d.columns), rows: JSON.stringify(d.rows),
        row_count: d.rowCount, workflow_id: d.workflowId ?? null,
      } as never).execute();
      return (await store.getByName(d.name))!;
    },
    async list() {
      const rows = await db.selectFrom(T).selectAll().orderBy('name').execute();
      return rows.map((r) => {
        const d = fromRow(r as Record<string, unknown>);
        return { name: d.name, rowCount: d.rowCount, workflowId: d.workflowId, updatedAt: d.updatedAt, publishedTable: d.publishedTable };
      });
    },
    async markPublished(name, publishedTable) {
      await db.updateTable(T).set({ published_table: publishedTable } as never).where('name', '=', name).execute();
    },
    async getByName(name) {
      const r = await db.selectFrom(T).selectAll().where('name', '=', name).executeTakeFirst();
      return r ? fromRow(r as Record<string, unknown>) : undefined;
    },
  };
  return store;
}
