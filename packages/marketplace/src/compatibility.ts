/** Compare dotted numeric versions (ignores build/prerelease suffixes). */
function cmp(a: string, b: string): number {
  const pa = a.split(/[.+-]/).map(Number);
  const pb = b.split(/[.+-]/).map(Number);
  for (let i = 0; i < 3; i++) {
    const na = Number.isFinite(pa[i]) ? pa[i] : 0;
    const nb = Number.isFinite(pb[i]) ? pb[i] : 0;
    if (na !== nb) return na - nb;
  }
  return 0;
}

function satisfiesComparator(version: string, comparator: string): boolean {
  const m = comparator.match(/^(>=|<=|>|<|=)?\s*(.+)$/);
  if (!m) return false;
  const op = m[1] ?? '=';
  const target = m[2].trim();
  if (target === '*') return true;
  const c = cmp(version, target);
  switch (op) {
    case '>=': return c >= 0;
    case '<=': return c <= 0;
    case '>': return c > 0;
    case '<': return c < 0;
    default: return c === 0;
  }
}

/** True if `version` satisfies the semver `range`. Supports `*`, exact, >=/<=/>/<, space=AND, `||`=OR. */
export function isCompatible(range: string, version: string): boolean {
  const trimmed = range.trim();
  if (trimmed === '' || trimmed === '*') return true;
  return trimmed.split('||').some((orPart) =>
    orPart.trim().split(/\s+/).filter(Boolean).every((cmpStr) => satisfiesComparator(version, cmpStr)),
  );
}
