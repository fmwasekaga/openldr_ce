export interface Provenance {
  sourceSystem?: string;
  pluginId?: string;
  pluginVersion?: string;
  batchId?: string;
}

/** Row shape shared by every SELECT that pulls the provenance columns off
 *  `fhir.fhir_resources` (getWithProvenance, reprojectAll's rebuild scan, ...). */
export interface ProvenanceColumns {
  source_system: string | null;
  plugin_id: string | null;
  plugin_version: string | null;
  batch_id: string | null;
}

/** Map the raw NULL-able columns to a `Provenance`, omitting NULLs rather than
 *  carrying them: Provenance's fields are optional, and provColumns() maps
 *  absent -> NULL on the way back out. The single source of truth for that
 *  mapping — do not hand-roll it a second time at a call site. */
export function provenanceFromRow(row: ProvenanceColumns): Provenance {
  const provenance: Provenance = {};
  if (row.source_system !== null) provenance.sourceSystem = row.source_system;
  if (row.plugin_id !== null) provenance.pluginId = row.plugin_id;
  if (row.plugin_version !== null) provenance.pluginVersion = row.plugin_version;
  if (row.batch_id !== null) provenance.batchId = row.batch_id;
  return provenance;
}
