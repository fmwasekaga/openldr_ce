import { OpenLdrError } from '@openldr/core';

export type PeriodType = 'monthly' | 'quarterly' | 'yearly';

function pad2(n: number): string { return String(n).padStart(2, '0'); }

export function currentPeriod(type: PeriodType, now: Date): string {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  if (type === 'yearly') return String(y);
  if (type === 'quarterly') return `${y}Q${Math.floor(m / 3) + 1}`;
  return `${y}${pad2(m + 1)}`;
}

export function previousPeriod(type: PeriodType, now: Date): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  if (type === 'yearly') return String(d.getUTCFullYear() - 1);
  if (type === 'quarterly') { d.setUTCMonth(d.getUTCMonth() - 3); return `${d.getUTCFullYear()}Q${Math.floor(d.getUTCMonth() / 3) + 1}`; }
  d.setUTCMonth(d.getUTCMonth() - 1);
  return `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}`;
}

export function periodRange(period: string): { from: string; to: string } {
  let y: number; let startM: number; let months: number;
  const q = /^(\d{4})Q([1-4])$/.exec(period);
  const mo = /^(\d{4})(\d{2})$/.exec(period);
  const yr = /^(\d{4})$/.exec(period);
  if (q) { y = +q[1]; startM = (+q[2] - 1) * 3; months = 3; }
  else if (mo) { y = +mo[1]; startM = +mo[2] - 1; months = 1; }
  else if (yr) { y = +yr[1]; startM = 0; months = 12; }
  else throw new OpenLdrError(`invalid DHIS2 period: '${period}'`);
  const from = `${y}-${pad2(startM + 1)}-01`;
  const end = new Date(Date.UTC(y, startM + months, 0));
  const to = `${end.getUTCFullYear()}-${pad2(end.getUTCMonth() + 1)}-${pad2(end.getUTCDate())}`;
  return { from, to };
}

export function nextPeriodBoundary(type: PeriodType, now: Date): Date {
  const y = now.getUTCFullYear(); const m = now.getUTCMonth();
  if (type === 'yearly') return new Date(Date.UTC(y + 1, 0, 1));
  if (type === 'quarterly') return new Date(Date.UTC(y, (Math.floor(m / 3) + 1) * 3, 1));
  return new Date(Date.UTC(y, m + 1, 1));
}
