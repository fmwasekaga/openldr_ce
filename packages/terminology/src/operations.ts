import type { ConceptSource } from './source';
import { valueSetOf } from './source';
import { expandCompose, type ExpandDeps, type VsCompose } from './expander';
import type { ValueSet } from '@openldr/fhir';
import type { MapElement } from '@openldr/db';

export interface LookupResult { found: boolean; system: string; code: string; display: string | null; properties: Record<string, unknown> | null }
export interface ValidateResult { result: boolean; message: string }
export interface TranslateResult { result: boolean; matches: MapElement[] }
export interface ExpandOptions { count?: number; offset?: number }

export class TerminologyError extends Error {
  constructor(message: string, public readonly kind: 'not-found' | 'invalid') { super(message); this.name = 'TerminologyError'; }
}

export interface Operations {
  lookup(system: string, code: string): Promise<LookupResult>;
  validateCode(input: { system: string; code: string } | { valueSetUrl: string; code: string; system?: string }): Promise<ValidateResult>;
  expand(valueSetUrl: string, opts: ExpandOptions): Promise<ValueSet>;
  translate(input: { mapUrl?: string; system: string; code: string; targetSystem?: string }): Promise<TranslateResult>;
}

function makeDeps(source: ConceptSource): ExpandDeps {
  return {
    async listSystemConcepts(system, activeOnly) {
      const rows = await source.findConcepts({ system, limit: 10_000, offset: 0 });
      return rows.filter((r) => !activeOnly || r.status === 'ACTIVE' || r.status == null)
        .map((r) => ({ system: r.system, code: r.code, display: r.display }));
    },
    async filterConcepts(system, filters, activeOnly) {
      const f = filters[0];
      if (!f || (f.op !== '=' && f.op !== 'equals')) throw new TerminologyError(`filter op '${f?.op}' unsupported`, 'invalid');
      const rows = await source.findConcepts({ system, property: { name: f.property, value: f.value }, limit: 10_000, offset: 0 });
      return rows.filter((r) => !activeOnly || r.status === 'ACTIVE' || r.status == null)
        .map((r) => ({ system: r.system, code: r.code, display: r.display }));
    },
    async resolveDisplay(system, code) {
      const c = await source.getConcept(system, code);
      return c?.display ?? null;
    },
    async resolveValueSetCompose(url) {
      const vs = valueSetOf(await source.getResourceByUrl(url));
      return (vs?.compose as VsCompose | undefined) ?? null;
    },
  };
}

export function createOperations(source: ConceptSource): Operations {
  async function loadValueSet(url: string): Promise<ValueSet> {
    const vs = valueSetOf(await source.getResourceByUrl(url));
    if (!vs) throw new TerminologyError(`ValueSet not found: ${url}`, 'not-found');
    return vs;
  }

  async function expand(url: string, opts: ExpandOptions): Promise<ValueSet> {
    const vs = await loadValueSet(url);
    const { codes, total } = await expandCompose((vs.compose ?? { include: [] }) as VsCompose, makeDeps(source), { seedUrls: [url] });
    const count = opts.count ?? 100;
    const offset = opts.offset ?? 0;
    const page = codes.slice(offset, offset + count);
    return { ...vs, expansion: { total, offset, contains: page.map((c) => ({ system: c.system, code: c.code, display: c.display ?? undefined })) } };
  }

  return {
    async lookup(system, code) {
      const c = await source.getConcept(system, code);
      return c ? { found: true, system, code, display: c.display, properties: c.properties } : { found: false, system, code, display: null, properties: null };
    },
    expand,
    async translate(input) {
      const matches = await source.translate(input);
      return { result: matches.length > 0, matches };
    },
    async validateCode(input) {
      if ('valueSetUrl' in input) {
        const vs = await loadValueSet(input.valueSetUrl);
        const { codes } = await expandCompose((vs.compose ?? { include: [] }) as VsCompose, makeDeps(source), { seedUrls: [input.valueSetUrl] });
        const ok = codes.some((c) => c.code === input.code && (!input.system || c.system === input.system));
        return { result: ok, message: ok ? `${input.code} is in ${input.valueSetUrl}` : `${input.code} not in ${input.valueSetUrl}` };
      }
      const c = await source.getConcept(input.system, input.code);
      return c ? { result: true, message: `${input.code} is in ${input.system}` } : { result: false, message: `${input.code} not found in ${input.system}` };
    },
  };
}
