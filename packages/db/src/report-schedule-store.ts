import { type Kysely, sql } from 'kysely';
import type { InternalSchema } from './schema/internal';

export type ScheduleFrequency = 'daily' | 'weekly' | 'monthly' | 'quarterly';
export type ScheduleOutputFormat = 'csv' | 'xlsx' | 'pdf';

export interface ScheduleRecord {
  id: string;
  reportId: string;
  params: Record<string, unknown>;
  frequency: ScheduleFrequency;
  dayOfWeek: number | null;
  dayOfMonth: number | null;
  outputFormat: ScheduleOutputFormat;
  enabled: boolean;
  lastRunAt: Date | null;
  nextDueAt: Date | null;
  createdBy: string | null;
}

export interface NewSchedule {
  id: string;
  reportId: string;
  params: Record<string, unknown>;
  frequency: ScheduleFrequency;
  dayOfWeek: number | null;
  dayOfMonth: number | null;
  outputFormat: ScheduleOutputFormat;
  createdBy: string | null;
  nextDueAt: Date;
}

export interface SchedulePatch {
  enabled?: boolean;
  frequency?: ScheduleFrequency;
  dayOfWeek?: number | null;
  dayOfMonth?: number | null;
  outputFormat?: ScheduleOutputFormat;
  params?: Record<string, unknown>;
  nextDueAt?: Date;
}

export interface ScheduleRunRecord {
  id: string;
  scheduleId: string;
  reportId: string;
  reportName: string;
  runAt: Date;
  periodStart: Date | null;
  periodEnd: Date | null;
  outputFormat: string;
  objectKey: string | null;
  byteSize: number | null;
  rowCount: number | null;
  status: 'success' | 'failed';
  errorMessage: string | null;
}

export interface NewScheduleRun extends Omit<ScheduleRunRecord, 'runAt'> {
  runAt: Date;
}

export interface ReportScheduleStore {
  create(s: NewSchedule): Promise<void>;
  get(id: string): Promise<ScheduleRecord | null>;
  list(opts: { reportId?: string }): Promise<ScheduleRecord[]>;
  update(id: string, patch: SchedulePatch): Promise<void>;
  remove(id: string): Promise<void>;
  setNextDue(id: string, at: Date): Promise<void>;
  markRun(id: string, at: Date): Promise<void>;
  recordRun(run: NewScheduleRun): Promise<void>;
  listRuns(opts: { reportId?: string; scheduleId?: string; limit: number; offset: number }):
    Promise<{ runs: ScheduleRunRecord[]; total: number }>;
  getRun(runId: string): Promise<ScheduleRunRecord | null>;
}

function toSchedule(r: {
  id: string; report_id: string; params: Record<string, unknown>; frequency: string;
  day_of_week: number | null; day_of_month: number | null; output_format: string;
  enabled: boolean; last_run_at: Date | null; next_due_at: Date | null; created_by: string | null;
}): ScheduleRecord {
  return {
    id: r.id, reportId: r.report_id, params: r.params ?? {},
    frequency: r.frequency as ScheduleFrequency, dayOfWeek: r.day_of_week, dayOfMonth: r.day_of_month,
    outputFormat: r.output_format as ScheduleOutputFormat, enabled: r.enabled,
    lastRunAt: r.last_run_at, nextDueAt: r.next_due_at, createdBy: r.created_by,
  };
}

function toRun(r: {
  id: string; schedule_id: string; report_id: string; report_name: string; run_at: Date;
  period_start: Date | null; period_end: Date | null; output_format: string;
  object_key: string | null; byte_size: number | null; row_count: number | null;
  status: string; error_message: string | null;
}): ScheduleRunRecord {
  return {
    id: r.id, scheduleId: r.schedule_id, reportId: r.report_id, reportName: r.report_name,
    runAt: r.run_at, periodStart: r.period_start, periodEnd: r.period_end,
    outputFormat: r.output_format, objectKey: r.object_key, byteSize: r.byte_size,
    rowCount: r.row_count, status: r.status as 'success' | 'failed', errorMessage: r.error_message,
  };
}

const SCHEDULE_COLS = ['id', 'report_id', 'params', 'frequency', 'day_of_week', 'day_of_month',
  'output_format', 'enabled', 'last_run_at', 'next_due_at', 'created_by'] as const;
const RUN_COLS = ['id', 'schedule_id', 'report_id', 'report_name', 'run_at', 'period_start',
  'period_end', 'output_format', 'object_key', 'byte_size', 'row_count', 'status', 'error_message'] as const;

export function createReportScheduleStore(db: Kysely<InternalSchema>): ReportScheduleStore {
  return {
    async create(s) {
      await db.insertInto('report_schedules').values({
        id: s.id, report_id: s.reportId, params: JSON.stringify(s.params) as never,
        frequency: s.frequency, day_of_week: s.dayOfWeek, day_of_month: s.dayOfMonth,
        output_format: s.outputFormat, created_by: s.createdBy, next_due_at: s.nextDueAt,
      }).execute();
    },
    async get(id) {
      const r = await db.selectFrom('report_schedules').select(SCHEDULE_COLS).where('id', '=', id).executeTakeFirst();
      return r ? toSchedule(r) : null;
    },
    async list({ reportId }) {
      let q = db.selectFrom('report_schedules').select(SCHEDULE_COLS);
      if (reportId) q = q.where('report_id', '=', reportId);
      return (await q.orderBy('created_at', 'desc').execute()).map(toSchedule);
    },
    async update(id, patch) {
      const set: Record<string, unknown> = { updated_at: sql`now()` };
      if (patch.enabled !== undefined) set.enabled = patch.enabled;
      if (patch.frequency !== undefined) set.frequency = patch.frequency;
      if (patch.dayOfWeek !== undefined) set.day_of_week = patch.dayOfWeek;
      if (patch.dayOfMonth !== undefined) set.day_of_month = patch.dayOfMonth;
      if (patch.outputFormat !== undefined) set.output_format = patch.outputFormat;
      if (patch.params !== undefined) set.params = JSON.stringify(patch.params) as never;
      if (patch.nextDueAt !== undefined) set.next_due_at = patch.nextDueAt;
      await db.updateTable('report_schedules').set(set).where('id', '=', id).execute();
    },
    async remove(id) { await db.deleteFrom('report_schedules').where('id', '=', id).execute(); },
    async setNextDue(id, at) {
      await db.updateTable('report_schedules').set({ next_due_at: at, updated_at: sql`now()` }).where('id', '=', id).execute();
    },
    async markRun(id, at) {
      await db.updateTable('report_schedules').set({ last_run_at: at, updated_at: sql`now()` }).where('id', '=', id).execute();
    },
    async recordRun(run) {
      await db.insertInto('report_schedule_runs').values({
        id: run.id, schedule_id: run.scheduleId, report_id: run.reportId, report_name: run.reportName,
        run_at: run.runAt, period_start: run.periodStart, period_end: run.periodEnd,
        output_format: run.outputFormat, object_key: run.objectKey, byte_size: run.byteSize,
        row_count: run.rowCount, status: run.status, error_message: run.errorMessage,
      }).execute();
    },
    async listRuns({ reportId, scheduleId, limit, offset }) {
      let q = db.selectFrom('report_schedule_runs').select(RUN_COLS);
      if (reportId) q = q.where('report_id', '=', reportId);
      if (scheduleId) q = q.where('schedule_id', '=', scheduleId);
      const rows = await q.orderBy('created_at', 'desc').limit(limit).offset(offset).execute();
      let cq = db.selectFrom('report_schedule_runs').select((eb) => eb.fn.countAll<number>().as('total'));
      if (reportId) cq = cq.where('report_id', '=', reportId);
      if (scheduleId) cq = cq.where('schedule_id', '=', scheduleId);
      const c = await cq.executeTakeFirst();
      return { runs: rows.map(toRun), total: Number(c?.total ?? 0) };
    },
    async getRun(runId) {
      const r = await db.selectFrom('report_schedule_runs').select(RUN_COLS).where('id', '=', runId).executeTakeFirst();
      return r ? toRun(r) : null;
    },
  };
}
