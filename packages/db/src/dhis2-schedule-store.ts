import { type Kysely, sql } from 'kysely';
import type { InternalSchema } from './schema/internal';

export type ScheduleMode = 'aggregate' | 'tracker';
export type SchedulePeriodType = 'monthly' | 'quarterly' | 'yearly';

export interface ScheduleRecord {
  id: string;
  mappingId: string;
  mode: ScheduleMode;
  periodType: SchedulePeriodType;
  eventDriven: boolean;
  enabled: boolean;
  lastRunAt: Date | null;
  nextDueAt: Date | null;
}

export interface NewSchedule {
  id: string;
  mappingId: string;
  mode: ScheduleMode;
  periodType: SchedulePeriodType;
  eventDriven: boolean;
}

export interface ScheduleStore {
  create(s: NewSchedule): Promise<void>;
  get(id: string): Promise<ScheduleRecord | null>;
  list(): Promise<ScheduleRecord[]>;
  remove(id: string): Promise<void>;
  setNextDue(id: string, at: Date): Promise<void>;
  markRun(id: string, at: Date): Promise<void>;
  setEnabled(id: string, enabled: boolean): Promise<void>;
}

function toRecord(r: {
  id: string; mapping_id: string; mode: string; period_type: string;
  event_driven: boolean; enabled: boolean; last_run_at: Date | null; next_due_at: Date | null;
}): ScheduleRecord {
  return {
    id: r.id, mappingId: r.mapping_id, mode: r.mode as ScheduleMode, periodType: r.period_type as SchedulePeriodType,
    eventDriven: r.event_driven, enabled: r.enabled, lastRunAt: r.last_run_at, nextDueAt: r.next_due_at,
  };
}

export function createScheduleStore(db: Kysely<InternalSchema>): ScheduleStore {
  return {
    async create(s) {
      await db.insertInto('dhis2_schedules').values({
        id: s.id, mapping_id: s.mappingId, mode: s.mode, period_type: s.periodType, event_driven: s.eventDriven,
      }).execute();
    },
    async get(id) {
      const r = await db.selectFrom('dhis2_schedules')
        .select(['id', 'mapping_id', 'mode', 'period_type', 'event_driven', 'enabled', 'last_run_at', 'next_due_at'])
        .where('id', '=', id).executeTakeFirst();
      return r ? toRecord(r) : null;
    },
    async list() {
      const rows = await db.selectFrom('dhis2_schedules')
        .select(['id', 'mapping_id', 'mode', 'period_type', 'event_driven', 'enabled', 'last_run_at', 'next_due_at'])
        .orderBy('id').execute();
      return rows.map(toRecord);
    },
    async remove(id) { await db.deleteFrom('dhis2_schedules').where('id', '=', id).execute(); },
    async setNextDue(id, at) {
      await db.updateTable('dhis2_schedules').set({ next_due_at: at, updated_at: sql`now()` }).where('id', '=', id).execute();
    },
    async markRun(id, at) {
      await db.updateTable('dhis2_schedules').set({ last_run_at: at, updated_at: sql`now()` }).where('id', '=', id).execute();
    },
    async setEnabled(id, enabled) {
      await db.updateTable('dhis2_schedules').set({ enabled, updated_at: sql`now()` }).where('id', '=', id).execute();
    },
  };
}
