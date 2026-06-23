import parser from 'cron-parser';

/** Next fire time strictly after `after`, interpreting the expression in `tz` (default UTC). */
export function nextCronDate(cron: string, tz: string | null, after: Date): Date {
  const interval = parser.parseExpression(cron, { currentDate: after, tz: tz ?? 'UTC' });
  return interval.next().toDate();
}
