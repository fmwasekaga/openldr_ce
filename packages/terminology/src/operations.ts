import type { ConceptSource } from './source';
import { valueSetOf } from './source';
import type { ValueSet } from '@openldr/fhir';
import type { ConceptRecord, MapElement } from '@openldr/db';

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

async function includeConcepts(source: ConceptSource, rule: { system?: string; concept?: { code: string }[]; filter?: { property: string; op: string; value: string }[] }, limit: number, offset: number): Promise<{ rows: ConceptRecord[]; total: number }> {
  if (!rule.system) throw new TerminologyError('compose.include without system is unsupported', 'invalid');
  if (rule.concept) {
    const codes = rule.concept.map((c) => c.code);
    const rows = await source.findConcepts({ system: rule.system, codes, limit, offset });
    const total = await source.countConcepts({ system: rule.system, codes });
    return { rows, total };
  }
  let property: { name: string; value: string } | undefined;
  if (rule.filter && rule.filter.length > 0) {
    const f = rule.filter[0];
    if (f.op !== '=' && f.op !== 'equals') throw new TerminologyError(`filter op '${f.op}' unsupported`, 'invalid');
    property = { name: f.property, value: f.value };
  }
  const rows = await source.findConcepts({ system: rule.system, property, limit, offset });
  const total = await source.countConcepts({ system: rule.system, property });
  return { rows, total };
}

export function createOperations(source: ConceptSource): Operations {
  async function loadValueSet(url: string): Promise<ValueSet> {
    const vs = valueSetOf(await source.getResourceByUrl(url));
    if (!vs) throw new TerminologyError(`ValueSet not found: ${url}`, 'not-found');
    return vs;
  }

  async function expand(url: string, opts: ExpandOptions): Promise<ValueSet> {
    const vs = await loadValueSet(url);
    const includes = vs.compose?.include ?? [];
    if (includes.length !== 1) throw new TerminologyError('Slice A supports exactly one compose.include', 'invalid');
    const count = opts.count ?? 100;
    const offset = opts.offset ?? 0;
    const { rows, total } = await includeConcepts(source, includes[0], count, offset);
    return { ...vs, expansion: { total, offset, contains: rows.map((r) => ({ system: r.system, code: r.code, display: r.display ?? undefined })) } };
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
        const rule = vs.compose?.include?.[0];
        if (!rule?.system) throw new TerminologyError('ValueSet has no resolvable include', 'invalid');
        const c = await source.getConcept(rule.system, input.code);
        const inExplicit = rule.concept ? rule.concept.some((x) => x.code === input.code) : true;
        const ok = !!c && inExplicit;
        return { result: ok, message: ok ? `${input.code} is in ${input.valueSetUrl}` : `${input.code} not in ${input.valueSetUrl}` };
      }
      const c = await source.getConcept(input.system, input.code);
      return c ? { result: true, message: `${input.code} is in ${input.system}` } : { result: false, message: `${input.code} not found in ${input.system}` };
    },
  };
}
