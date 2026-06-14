import type { ConceptSource } from './source';

export interface LookupResult { found: boolean; system: string; code: string; display: string | null; properties: Record<string, unknown> | null }
export interface ValidateResult { result: boolean; message: string }

export interface Operations {
  lookup(system: string, code: string): Promise<LookupResult>;
  validateCode(input: { system: string; code: string } | { valueSetUrl: string; code: string; system?: string }): Promise<ValidateResult>;
}

export function createOperations(source: ConceptSource): Operations {
  return {
    async lookup(system, code) {
      const c = await source.getConcept(system, code);
      return c ? { found: true, system, code, display: c.display, properties: c.properties } : { found: false, system, code, display: null, properties: null };
    },
    async validateCode(input) {
      if ('system' in input && !('valueSetUrl' in input)) {
        const c = await source.getConcept(input.system, input.code);
        return c ? { result: true, message: `${input.code} is in ${input.system}` } : { result: false, message: `${input.code} not found in ${input.system}` };
      }
      throw new Error('validateCode ValueSet mode not yet implemented');
    },
  };
}
