import { OpenLdrError } from '@openldr/core';
import type { MappingSource } from './types';

export function dispatchReportSource(source: MappingSource): { reportId: string; params?: Record<string, string> } {
  if (source.kind !== 'report') {
    throw new OpenLdrError(`unsupported mapping source kind '${(source as { kind: string }).kind}' (Slice A supports 'report')`);
  }
  return { reportId: source.reportId, params: source.params };
}
