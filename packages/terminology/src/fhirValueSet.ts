import type { ExpandedConcept, VsCompose, VsInclude } from './expander';

// Shape the store/UI use as the canonical authoring input.
export type ValueSetStatus = 'draft' | 'active' | 'retired';
export interface ValueSetInput {
  url: string;
  version: string | null;
  name: string | null;
  title: string | null;
  status: ValueSetStatus;
  experimental: boolean;
  description: string | null;
  compose: VsCompose;
  publisherId?: string | null;
  category?: string | null;
}
export interface ValueSetCore {
  id: string; url: string; status: ValueSetStatus; experimental: boolean;
  version: string | null; name: string | null; title: string | null;
  description: string | null; compose: VsCompose;
}

function isObj(v: unknown): v is Record<string, unknown> { return typeof v === 'object' && v !== null; }
function str(v: unknown): string | undefined { return typeof v === 'string' ? v : undefined; }

const STATUS: ValueSetStatus[] = ['draft', 'active', 'retired'];
function mapStatus(v: unknown): ValueSetStatus {
  const s = str(v);
  return s && (STATUS as string[]).includes(s) ? (s as ValueSetStatus) : 'draft';
}

function mapClause(raw: unknown): VsInclude {
  const r = isObj(raw) ? raw : {};
  const out: VsInclude = {};
  if (str(r.system)) out.system = str(r.system);
  if (Array.isArray(r.concept)) {
    const concept = r.concept.filter(isObj).map((c) => {
      const code = String(c.code ?? '');
      const display = str(c.display);
      return display ? { code, display } : { code };
    }).filter((c) => c.code !== '');
    if (concept.length) out.concept = concept;
  }
  if (Array.isArray(r.filter)) {
    const filter = r.filter.filter(isObj).map((f) => ({
      property: String(f.property ?? ''),
      op: String(f.op ?? '='),
      value: String(f.value ?? ''),
    })).filter((f) => f.property !== '' && f.value !== '');
    if (filter.length) out.filter = filter;
  }
  if (Array.isArray(r.valueSet)) {
    const urls = r.valueSet.map(str).filter((u): u is string => !!u);
    if (urls.length) out.valueSet = urls;
  }
  return out;
}

function composeFromExpansion(contains: unknown[]): VsCompose {
  const bySystem = new Map<string, { code: string; display?: string }[]>();
  for (const c of contains) {
    if (!isObj(c)) continue;
    const system = str(c.system); const code = str(c.code);
    if (!system || !code) continue;
    const arr = bySystem.get(system) ?? [];
    arr.push({ code, ...(str(c.display) ? { display: str(c.display) } : {}) });
    bySystem.set(system, arr);
  }
  return { include: [...bySystem.entries()].map(([system, concept]) => ({ system, concept })) };
}

/** Map an arbitrary FHIR R4 ValueSet resource (parsed JSON) to ValueSetInput. Throws on invalid input. */
export function fhirValueSetToInput(resource: unknown): ValueSetInput {
  if (!isObj(resource) || resource.resourceType !== 'ValueSet') {
    throw new Error('Not a FHIR ValueSet resource (resourceType must be "ValueSet")');
  }
  const url = str(resource.url);
  if (!url) throw new Error('FHIR ValueSet is missing a canonical "url"');

  let compose: VsCompose;
  if (isObj(resource.compose)) {
    const raw = resource.compose;
    const exclude = Array.isArray(raw.exclude) ? raw.exclude.filter(isObj).map(mapClause) : [];
    compose = {
      include: (Array.isArray(raw.include) ? raw.include : []).filter(isObj).map(mapClause),
      ...(exclude.length ? { exclude } : {}),
    };
  } else if (isObj(resource.expansion) && Array.isArray(resource.expansion.contains)) {
    compose = composeFromExpansion(resource.expansion.contains);
  } else {
    compose = { include: [] };
  }

  return {
    url,
    version: str(resource.version) ?? null,
    name: str(resource.name) ?? null,
    title: str(resource.title) ?? null,
    status: mapStatus(resource.status),
    experimental: resource.experimental === true,
    description: str(resource.description) ?? null,
    compose,
  };
}

/** Emit a ValueSet (+ optional cached expansion) as a FHIR R4 ValueSet resource. */
export function valueSetToFhirResource(vs: ValueSetCore, expansion?: ExpandedConcept[]): Record<string, unknown> {
  const out: Record<string, unknown> = {
    resourceType: 'ValueSet', id: vs.id, url: vs.url, status: vs.status,
    experimental: vs.experimental, compose: vs.compose,
  };
  if (vs.version) out.version = vs.version;
  if (vs.name) out.name = vs.name;
  if (vs.title) out.title = vs.title;
  if (vs.description) out.description = vs.description;
  if (expansion && expansion.length) {
    out.expansion = {
      total: expansion.length,
      contains: expansion.map((c) => ({ system: c.system, code: c.code, ...(c.display ? { display: c.display } : {}) })),
    };
  }
  return out;
}
