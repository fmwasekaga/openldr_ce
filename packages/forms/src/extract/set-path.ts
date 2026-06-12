/** Write `value` at a dotted path (numeric segments become array indices), creating intermediates. */
export function setPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.');
  let cur: Record<string | number, unknown> = target as Record<string | number, unknown>;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = /^\d+$/.test(parts[i]) ? Number(parts[i]) : parts[i];
    const nextIsIndex = /^\d+$/.test(parts[i + 1]);
    if (cur[key] === undefined) cur[key] = nextIsIndex ? [] : {};
    cur = cur[key] as Record<string | number, unknown>;
  }
  const last = parts[parts.length - 1];
  cur[/^\d+$/.test(last) ? Number(last) : last] = value;
}
