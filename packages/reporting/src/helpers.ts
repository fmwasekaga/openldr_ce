/** Pivot grouped interpretation rows into per-antibiotic R/I/S counts + %R. */
export function pivotResistance(
  grouped: { antibiotic: string; interpretation_code: string; n: number }[],
): { antibiotic: string; tested: number; r: number; i: number; s: number; percentR: number }[] {
  const byAb = new Map<string, { antibiotic: string; tested: number; r: number; i: number; s: number; percentR: number }>();
  for (const row of grouped) {
    const e = byAb.get(row.antibiotic) ?? { antibiotic: row.antibiotic, tested: 0, r: 0, i: 0, s: 0, percentR: 0 };
    const n = Number(row.n) || 0;
    e.tested += n;
    if (row.interpretation_code === 'R') e.r += n;
    else if (row.interpretation_code === 'I') e.i += n;
    else if (row.interpretation_code === 'S') e.s += n;
    byAb.set(row.antibiotic, e);
  }
  const out = [...byAb.values()];
  for (const e of out) e.percentR = e.tested === 0 ? 0 : Math.round((e.r / e.tested) * 1000) / 10;
  out.sort((a, b) => b.percentR - a.percentR);
  return out;
}

/** Age band from an ISO birth date relative to a reference ISO date. */
export function ageBand(birthDate: string | null, refIso: string): string {
  if (!birthDate) return 'unknown';
  const b = new Date(birthDate);
  const ref = new Date(refIso);
  if (Number.isNaN(b.getTime())) return 'unknown';
  let age = ref.getFullYear() - b.getFullYear();
  const m = ref.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && ref.getDate() < b.getDate())) age--;
  if (age < 0) return 'unknown';
  if (age <= 4) return '0-4';
  if (age <= 14) return '5-14';
  if (age <= 24) return '15-24';
  if (age <= 49) return '25-49';
  return '50+';
}

/** YYYY-MM bucket from an ISO timestamp; null/invalid → 'unknown'. */
export function monthKey(iso: string | null): string {
  if (!iso) return 'unknown';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'unknown';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Whole hours between two ISO timestamps, or null if either is missing/invalid or end<start. */
export function hoursBetween(startIso: string | null, endIso: string | null): number | null {
  if (!startIso || !endIso) return null;
  const a = new Date(startIso).getTime();
  const b = new Date(endIso).getTime();
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return null;
  return Math.round((b - a) / 3_600_000);
}

/** Extend a date-only (YYYY-MM-DD) upper bound to end-of-day UTC so the whole day is inclusive; pass other strings through. */
export function endOfDay(to: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(to) ? `${to}T23:59:59.999Z` : to;
}

/** Render columns+rows as RFC-4180-ish CSV. */
export function toCsv(columns: { key: string; label: string }[], rows: Record<string, unknown>[]): string {
  const esc = (v: unknown): string => {
    let s = v === null || v === undefined ? '' : String(v);
    if (/^[=@\t\r]/.test(s) || (/^[+\-]/.test(s) && Number.isNaN(Number(s)))) s = `'${s}`;
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = columns.map((c) => esc(c.label)).join(',');
  const body = rows.map((r) => columns.map((c) => esc(r[c.key])).join(',')).join('\n');
  return body ? `${header}\n${body}\n` : `${header}\n`;
}
