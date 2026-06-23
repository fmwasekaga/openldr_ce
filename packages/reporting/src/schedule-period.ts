export type ScheduleFrequency = 'daily' | 'weekly' | 'monthly' | 'quarterly';

const startOfDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
const endOfDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999));

/** Next firing time strictly after `from`, anchored at 06:00 UTC. */
export function nextRunAt(
  frequency: ScheduleFrequency,
  dayOfWeek: number | null,
  dayOfMonth: number | null,
  from: Date,
): Date {
  const next = new Date(from);
  next.setUTCHours(6, 0, 0, 0);
  switch (frequency) {
    case 'daily':
      next.setUTCDate(next.getUTCDate() + 1);
      return next;
    case 'weekly': {
      const target = dayOfWeek ?? 1; // 0=Sun..6=Sat, default Monday
      const daysUntil = ((target - from.getUTCDay()) + 7) % 7 || 7;
      next.setUTCDate(from.getUTCDate() + daysUntil);
      return next;
    }
    case 'monthly': {
      const target = Math.min(dayOfMonth ?? 1, 28);
      next.setUTCMonth(from.getUTCMonth() + 1, target);
      return next;
    }
    case 'quarterly': {
      const q = Math.floor(from.getUTCMonth() / 3);
      next.setUTCFullYear(from.getUTCFullYear(), (q + 1) * 3, 1);
      return next;
    }
  }
}

/** The just-completed period a run at `runAt` should cover. */
export function periodFor(frequency: ScheduleFrequency, runAt: Date):
  { start: Date; end: Date } {
  switch (frequency) {
    case 'daily': {
      const prev = new Date(runAt);
      prev.setUTCDate(prev.getUTCDate() - 1);
      return { start: startOfDay(prev), end: endOfDay(prev) };
    }
    case 'weekly': {
      const endDay = new Date(runAt);
      endDay.setUTCDate(endDay.getUTCDate() - 1);
      const startDay = new Date(endDay);
      startDay.setUTCDate(startDay.getUTCDate() - 6);
      return { start: startOfDay(startDay), end: endOfDay(endDay) };
    }
    case 'monthly': {
      const start = new Date(Date.UTC(runAt.getUTCFullYear(), runAt.getUTCMonth() - 1, 1, 0, 0, 0, 0));
      const lastDay = new Date(Date.UTC(runAt.getUTCFullYear(), runAt.getUTCMonth(), 0));
      return { start, end: endOfDay(lastDay) };
    }
    case 'quarterly': {
      const q = Math.floor(runAt.getUTCMonth() / 3);
      const prevQStartMonth = (q - 1) * 3;
      const start = new Date(Date.UTC(runAt.getUTCFullYear(), prevQStartMonth, 1, 0, 0, 0, 0));
      const end = new Date(Date.UTC(runAt.getUTCFullYear(), prevQStartMonth + 3, 0));
      return { start, end: endOfDay(end) };
    }
  }
}
