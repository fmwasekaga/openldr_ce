import { readFileSync } from 'node:fs';
import { validateResource, validateBundleEntries, type ValidationResult } from '@openldr/fhir';

export interface FhirValidateRow {
  label: string;
  valid: boolean;
  outcome?: unknown;
}

export interface FhirValidateOutput {
  file: string;
  results: FhirValidateRow[];
  allValid: boolean;
}

function toRow(label: string, result: ValidationResult): FhirValidateRow {
  return result.ok ? { label, valid: true } : { label, valid: false, outcome: result.outcome };
}

export function runFhirValidate(file: string): FhirValidateOutput {
  const data: unknown = JSON.parse(readFileSync(file, 'utf8'));
  const isBundle =
    typeof data === 'object' && data !== null && (data as Record<string, unknown>)['resourceType'] === 'Bundle';

  let results: FhirValidateRow[];
  if (isBundle) {
    const envelope = toRow('Bundle', validateResource(data));
    const entries = validateBundleEntries(data).map(({ entry, result }) => toRow(`entry[${entry}]`, result));
    results = [envelope, ...entries];
  } else {
    results = [toRow(String((data as Record<string, unknown>)?.['resourceType'] ?? 'resource'), validateResource(data))];
  }

  return { file, results, allValid: results.every((r) => r.valid) };
}

export function formatFhirValidate(out: FhirValidateOutput): string {
  const lines = out.results.map((r) => {
    if (r.valid) return `  ${r.label.padEnd(20)} valid`;
    const issues = (r.outcome as { issue?: { expression?: string[]; diagnostics?: string }[] }).issue ?? [];
    const detail = issues.map((i) => `${(i.expression ?? []).join('.')}: ${i.diagnostics}`).join('; ');
    return `  ${r.label.padEnd(20)} INVALID  ${detail}`;
  });
  return [`${out.file}: ${out.allValid ? 'all valid' : 'invalid'}`, ...lines].join('\n');
}
