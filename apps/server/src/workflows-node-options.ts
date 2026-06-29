/** An optionsSource resolver returns selectable {value,label} options for a config select. */
export interface NodeOption { value: string; label: string }

export interface NodeOptionsDeps {
  connectors: { list(): Promise<Array<{ id: string; name: string }>> };
  datasets: { list(): Promise<Array<{ name: string }>> };
  /** dhis2-sink mappings from plugin_data (id/name). */
  dhis2Mappings(): Promise<Array<{ id: string; name: string }>>;
}

/** Static FHIR resource types offered to source-node selects. */
export const FHIR_RESOURCE_TYPES = [
  'Patient', 'Observation', 'Condition', 'Encounter', 'Specimen',
  'DiagnosticReport', 'Organization', 'Location', 'Practitioner', 'ServiceRequest',
];

export interface NodeDetailDeps {
  /** Read the dhis2-sink mapping definition + org-unit map from plugin_data. */
  dhis2Mapping(value: string): Promise<{ mapping: unknown; orgUnitMap: Record<string, string> } | null>;
}

/**
 * Resolve a named detailSource to a config-detail object (e.g. a denormalized
 * mapping + org-unit map to inline into a sink node's config). Unknown source or
 * missing data → null. Never throws (best-effort).
 */
export async function resolveNodeDetail(source: string, value: string, deps: NodeDetailDeps): Promise<Record<string, unknown> | null> {
  try {
    if (source === 'dhis2-mapping') {
      const d = await deps.dhis2Mapping(value);
      return d ? { mapping: d.mapping, orgUnitMap: d.orgUnitMap } : null;
    }
    return null;
  } catch {
    return null;
  }
}

/** Resolve a named optionsSource to options. Unknown source → []. Never throws (best-effort). */
export async function resolveNodeOptions(source: string, deps: NodeOptionsDeps): Promise<NodeOption[]> {
  try {
    switch (source) {
      case 'connectors':
        return (await deps.connectors.list()).map((c) => ({ value: c.id, label: c.name }));
      case 'datasets':
        return (await deps.datasets.list()).map((d) => ({ value: d.name, label: d.name }));
      case 'dhis2-mappings':
        return (await deps.dhis2Mappings()).map((m) => ({ value: m.id, label: m.name }));
      case 'fhir-resource-types':
        return FHIR_RESOURCE_TYPES.map((t) => ({ value: t, label: t }));
      default:
        return [];
    }
  } catch {
    return [];
  }
}
