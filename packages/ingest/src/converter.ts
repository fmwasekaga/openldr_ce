import type { FhirResource } from '@openldr/fhir';

export interface ConvertContext {
  source?: string;
  batchId: string;
}

export interface Converter {
  readonly id: string;
  readonly version: string;
  convert(raw: Uint8Array, ctx: ConvertContext): Promise<FhirResource[]>;
}

export class ConverterRegistry {
  private readonly map = new Map<string, Converter>();
  register(c: Converter): void {
    this.map.set(c.id, c);
  }
  get(id: string): Converter | undefined {
    return this.map.get(id);
  }
  list(): string[] {
    return [...this.map.keys()].sort();
  }
}
