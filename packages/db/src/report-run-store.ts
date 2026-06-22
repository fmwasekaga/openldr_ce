import { randomUUID } from 'node:crypto';
import type { Kysely } from 'kysely';
import type { InternalSchema } from './schema/internal';

export type ReportRunFormat = 'preview' | 'csv' | 'pdf' | 'xlsx';

export interface ReportRunRecord {
  id: string;
  reportId: string;
  reportName: string;
  format: ReportRunFormat;
  params: Record<string, unknown>;
  rowCount: number | null;
  userId: string | null;
  userName: string | null;
  createdAt: Date;
}

export interface NewReportRun {
  reportId: string;
  reportName: string;
  format: ReportRunFormat;
  params: Record<string, unknown>;
  rowCount: number | null;
  userId: string | null;
  userName: string | null;
}

export interface ReportRunStore {
  record(run: NewReportRun): Promise<void>;
  list(opts: { reportId?: string; limit: number; offset: number }):
    Promise<{ runs: ReportRunRecord[]; total: number }>;
}

function toRecord(r: {
  id: string; report_id: string; report_name: string; format: string;
  params: Record<string, unknown>; row_count: number | null;
  user_id: string | null; user_name: string | null; created_at: Date;
}): ReportRunRecord {
  return {
    id: r.id, reportId: r.report_id, reportName: r.report_name,
    format: r.format as ReportRunFormat, params: r.params ?? {},
    rowCount: r.row_count, userId: r.user_id, userName: r.user_name,
    createdAt: r.created_at,
  };
}

export function createReportRunStore(db: Kysely<InternalSchema>): ReportRunStore {
  return {
    async record(run) {
      await db
        .insertInto('report_runs')
        .values({
          id: randomUUID(),
          report_id: run.reportId,
          report_name: run.reportName,
          format: run.format,
          params: JSON.stringify(run.params) as never,
          row_count: run.rowCount,
          user_id: run.userId,
          user_name: run.userName,
        })
        .execute();
    },
    async list({ reportId, limit, offset }) {
      let q = db.selectFrom('report_runs');
      if (reportId) q = q.where('report_id', '=', reportId);
      const rows = await q
        .selectAll()
        .orderBy('created_at', 'desc')
        .limit(limit)
        .offset(offset)
        .execute();

      let cq = db.selectFrom('report_runs').select((eb) => eb.fn.countAll<number>().as('total'));
      if (reportId) cq = cq.where('report_id', '=', reportId);
      const countRow = await cq.executeTakeFirst();

      return { runs: rows.map(toRecord), total: Number(countRow?.total ?? 0) };
    },
  };
}
