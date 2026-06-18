import type { FormSchema } from './schema/form-schema';

export interface FormContent {
  name: string;
  schema: FormSchema;
  targetPages?: string[] | null;
  fhirResourceType?: string | null;
  versionLabel?: string | null;
}

export function computeNextFormVersion(existingVersions: readonly number[]): number {
  return existingVersions.length === 0 ? 1 : Math.max(...existingVersions) + 1;
}

export function makeDuplicateName(name: string): string {
  return `${name} copy`;
}

export function formContentChanged(before: FormContent, after: FormContent): boolean {
  return (
    before.name !== after.name ||
    before.fhirResourceType !== after.fhirResourceType ||
    stableStringify(before.targetPages ?? null) !== stableStringify(after.targetPages ?? null) ||
    stableStringify(before.schema) !== stableStringify(after.schema)
  );
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, sortValue(child)]));
}
