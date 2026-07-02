import { CATALOG, DOMAINS } from '@openldr/core';

/** Render the error catalog for `openldr errors list`. Pure (no ctx) — the catalog is static. */
export function renderErrorCatalog(opts: { json: boolean }): string {
  const entries = Object.values(CATALOG).sort((a, b) => a.code.localeCompare(b.code));
  if (opts.json) return JSON.stringify(entries, null, 2);
  const lines: string[] = [];
  for (const prefix of Object.keys(DOMAINS)) {
    const group = entries.filter((e) => e.code.startsWith(prefix));
    if (!group.length) continue;
    lines.push(`# ${DOMAINS[prefix]} (${prefix})`);
    for (const e of group) lines.push(`  ${e.code}  ${String(e.httpStatus).padEnd(3)}  ${e.message}`);
  }
  return lines.join('\n');
}

export function runErrorsList(opts: { json: boolean }): number {
  process.stdout.write(renderErrorCatalog(opts) + '\n');
  return 0;
}
