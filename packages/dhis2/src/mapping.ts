import { OpenLdrError } from '@openldr/core';
import type { MappingSource } from './types';

export function dispatchReportSource(source: MappingSource): { reportId: string; params?: Record<string, string> } {
  if (source.kind !== 'report') {
    throw new OpenLdrError(`unsupported mapping source kind '${(source as { kind: string }).kind}' (Slice A supports 'report')`);
  }
  // A report source may legitimately omit `params`. Default to `{}` (not undefined): the report's
  // params schema is a `z.object(...)` whose `.parse(undefined)` throws "Required", whereas
  // `.parse({})` succeeds (all fields optional). Passing undefined here is what surfaced as the
  // redacted "operation connectors.push failed" on a DHIS2 dry-run/push.
  return { reportId: source.reportId, params: source.params ?? {} };
}
