import { randomUUID } from 'node:crypto';
import * as XLSX from 'xlsx';
import { toCsv, nextRunAt, periodFor, type ScheduleFrequency } from '@openldr/reporting';
import type { EventingPort } from '@openldr/ports';
import type { ReportScheduleStore } from '@openldr/db';

interface ReportColumnLike { key: string; label: string }

interface SchedulerReporting {
  list(): { id: string; name: string; parameters?: { type: string }[] }[];
  run(id: string, params: unknown): Promise<{ columns: ReportColumnLike[]; rows: Record<string, unknown>[]; meta: { rowCount: number } }>;
  renderPdf(id: string, params: unknown): Promise<Buffer>;
}

interface SchedulerDeps {
  reporting: SchedulerReporting;
  blob: { put(key: string, body: Uint8Array | string, contentType?: string): Promise<void> };
  schedules: ReportScheduleStore;
  logger: { error(obj: unknown, msg?: string): void };
}

export interface ReportScheduler {
  runDue(scheduleId: string): Promise<void>;
  runNow(scheduleId: string): void;
  registerRunner(eventing: EventingPort): Promise<void>;
  reconcile(eventing: EventingPort): Promise<void>;
}

const ymd = (d: Date) => d.toISOString().slice(0, 10);

function renderXlsx(columns: ReportColumnLike[], rows: Record<string, unknown>[]): Buffer {
  const data = rows.map((r) => Object.fromEntries(columns.map((c) => [c.label, r[c.key] ?? ''])));
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Report');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

export function createReportScheduler(deps: SchedulerDeps): ReportScheduler {
  async function runDue(scheduleId: string): Promise<void> {
    const s = await deps.schedules.get(scheduleId);
    if (!s || !s.enabled) return;
    const runId = randomUUID();
    const now = new Date();
    const period = periodFor(s.frequency as ScheduleFrequency, now);
    const def = deps.reporting.list().find((r) => r.id === s.reportId);
    const reportName = def?.name ?? s.reportId;
    try {
      const hasDateRange = def?.parameters?.some((p) => p.type === 'daterange') ?? false;
      const params: Record<string, unknown> = { ...s.params };
      if (hasDateRange) { params.from = ymd(period.start); params.to = ymd(period.end); }

      let bytes: Buffer; let contentType: string; let ext: string; let rowCount: number;
      if (s.outputFormat === 'pdf') {
        const result = await deps.reporting.run(s.reportId, params);
        rowCount = result.meta.rowCount;
        bytes = await deps.reporting.renderPdf(s.reportId, params);
        contentType = 'application/pdf'; ext = 'pdf';
      } else {
        const result = await deps.reporting.run(s.reportId, params);
        rowCount = result.meta.rowCount;
        if (s.outputFormat === 'xlsx') {
          bytes = renderXlsx(result.columns, result.rows);
          contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'; ext = 'xlsx';
        } else {
          bytes = Buffer.from(toCsv(result.columns, result.rows), 'utf8');
          contentType = 'text/csv'; ext = 'csv';
        }
      }
      const objectKey = `report-schedules/${s.id}/${runId}.${ext}`;
      await deps.blob.put(objectKey, bytes, contentType);
      await deps.schedules.recordRun({
        id: runId, scheduleId: s.id, reportId: s.reportId, reportName, runAt: now,
        periodStart: period.start, periodEnd: period.end, outputFormat: s.outputFormat,
        objectKey, byteSize: bytes.length, rowCount, status: 'success', errorMessage: null,
      });
    } catch (err) {
      deps.logger.error({ err, scheduleId }, 'report schedule run failed');
      await deps.schedules.recordRun({
        id: runId, scheduleId: s.id, reportId: s.reportId, reportName, runAt: now,
        periodStart: period.start, periodEnd: period.end, outputFormat: s.outputFormat,
        objectKey: null, byteSize: null, rowCount: null, status: 'failed',
        errorMessage: err instanceof Error ? err.message : String(err),
      });
    }
    await deps.schedules.markRun(s.id, now);
  }

  return {
    runDue,
    runNow(scheduleId) {
      void runDue(scheduleId).catch((err) => deps.logger.error({ err, scheduleId }, 'report run-now failed'));
    },
    async registerRunner(eventing) {
      await eventing.subscribe('report.schedule.due', async (event) => {
        const { scheduleId } = event.payload as { scheduleId: string };
        if (!(await deps.schedules.get(scheduleId))) return;
        await runDue(scheduleId);
        // Re-fetch after the run so a mid-run disable/edit (cadence change) is honored
        // when re-arming, rather than re-arming from a stale pre-run snapshot.
        const after = await deps.schedules.get(scheduleId);
        if (!after || !after.enabled) return;
        const due = nextRunAt(after.frequency as ScheduleFrequency, after.dayOfWeek, after.dayOfMonth, new Date());
        await deps.schedules.setNextDue(scheduleId, due);
        await eventing.publish({ type: 'report.schedule.due', payload: { scheduleId } }, { availableAt: due });
      });
    },
    async reconcile(eventing) {
      const now = Date.now();
      for (const s of await deps.schedules.list({})) {
        if (!s.enabled) continue;
        // Already armed for the future (its due event is still pending in the durable
        // outbox) — skip, or every restart would re-arm and compound duplicate runs.
        if (s.nextDueAt && s.nextDueAt.getTime() > now) continue;
        const due = s.nextDueAt && s.nextDueAt.getTime() <= now
          ? s.nextDueAt
          : nextRunAt(s.frequency as ScheduleFrequency, s.dayOfWeek, s.dayOfMonth, new Date());
        await deps.schedules.setNextDue(s.id, due);
        await eventing.publish({ type: 'report.schedule.due', payload: { scheduleId: s.id } }, { availableAt: due });
      }
    },
  };
}
