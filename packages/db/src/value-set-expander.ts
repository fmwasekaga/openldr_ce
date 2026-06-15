// Async port of corlix apps/desktop/src/main/expander.ts. Pure: all I/O is via the
// injected ExpandDeps adapter.

export interface ExpandedConcept { system: string; code: string; display: string | null }

export interface VsFilter { property: string; op: string; value: string }
export interface VsInclude {
  system?: string;
  version?: string;
  concept?: { code: string; display?: string }[];
  filter?: VsFilter[];
  valueSet?: string[];
}
export interface VsCompose { include?: VsInclude[]; exclude?: VsInclude[] }

export interface ExpandDeps {
  listSystemConcepts(systemUrl: string, activeOnly: boolean): Promise<ExpandedConcept[]>;
  filterConcepts(systemUrl: string, filters: VsFilter[], activeOnly: boolean): Promise<ExpandedConcept[]>;
  resolveDisplay(systemUrl: string, code: string): Promise<string | null>;
  resolveValueSetCompose(url: string): Promise<VsCompose | null>;
}

export interface ExpandComposeOptions { activeOnly?: boolean; seedUrls?: string[] }

const keyOf = (c: { system: string; code: string }): string => `${c.system}|${c.code}`;
const MAX_IMPORT_DEPTH = 16;

function dedup(codes: ExpandedConcept[]): ExpandedConcept[] {
  const seen = new Set<string>();
  const out: ExpandedConcept[] = [];
  for (const c of codes) {
    const k = keyOf(c);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(c);
  }
  return out;
}

async function expandImport(url: string, deps: ExpandDeps, activeOnly: boolean, visited: Set<string>, depth: number): Promise<ExpandedConcept[]> {
  if (depth >= MAX_IMPORT_DEPTH || visited.has(url)) return [];
  const compose = await deps.resolveValueSetCompose(url);
  if (!compose) return [];
  const next = new Set(visited);
  next.add(url);
  return (await expandInner(compose, deps, activeOnly, next, depth + 1)).codes;
}

async function collectClause(clause: VsInclude, deps: ExpandDeps, activeOnly: boolean, visited: Set<string>, depth: number): Promise<ExpandedConcept[]> {
  const sets: ExpandedConcept[][] = [];

  if (clause.system) {
    const hasConcept = !!(clause.concept && clause.concept.length > 0);
    const hasFilter = !!(clause.filter && clause.filter.length > 0);
    if (hasConcept) {
      sets.push(await Promise.all(clause.concept!.map(async (c) => ({
        system: clause.system!, code: c.code,
        display: c.display ?? (await deps.resolveDisplay(clause.system!, c.code)),
      }))));
    }
    if (hasFilter) sets.push(await deps.filterConcepts(clause.system, clause.filter!, activeOnly));
    if (!hasConcept && !hasFilter) sets.push(await deps.listSystemConcepts(clause.system, activeOnly));
  }

  for (const url of clause.valueSet ?? []) {
    sets.push(await expandImport(url, deps, activeOnly, visited, depth));
  }

  if (sets.length === 0) return [];
  if (sets.length === 1) return dedup(sets[0]!);
  const [first, ...rest] = sets;
  const restKeys = rest.map((s) => new Set(s.map(keyOf)));
  return dedup(first!.filter((c) => restKeys.every((ks) => ks.has(keyOf(c)))));
}

async function expandInner(compose: VsCompose, deps: ExpandDeps, activeOnly: boolean, visited: Set<string>, depth: number): Promise<{ codes: ExpandedConcept[]; total: number }> {
  const included: ExpandedConcept[] = [];
  for (const inc of compose.include ?? []) included.push(...(await collectClause(inc, deps, activeOnly, visited, depth)));
  let codes = dedup(included);

  if (compose.exclude && compose.exclude.length > 0) {
    const excluded: ExpandedConcept[] = [];
    for (const exc of compose.exclude) excluded.push(...(await collectClause(exc, deps, activeOnly, visited, depth)));
    const exKeys = new Set(excluded.map(keyOf));
    codes = codes.filter((c) => !exKeys.has(keyOf(c)));
  }
  return { codes, total: codes.length };
}

/** Resolve a ValueSet.compose into a flat, deduped code list. */
export async function expandCompose(compose: VsCompose, deps: ExpandDeps, opts: ExpandComposeOptions = {}): Promise<{ codes: ExpandedConcept[]; total: number }> {
  const activeOnly = opts.activeOnly !== false;
  const visited = new Set<string>(opts.seedUrls ?? []);
  return expandInner(compose, deps, activeOnly, visited, 0);
}
