/** An optionsSource resolver returns selectable {value,label} options for a config select. */
export interface NodeOption { value: string; label: string }

export interface NodeOptionsDeps {
  connectors: { list(): Promise<Array<{ id: string; name: string; pluginId: string }>> };
  datasets: { list(): Promise<Array<{ name: string }>> };
  /** dhis2-sink mappings from plugin_data (id/name). */
  dhis2Mappings(): Promise<Array<{ id: string; name: string }>>;
  /** Published forms for the Form Validate node picker. */
  forms: { listPublished(): Promise<Array<{ id: string; name: string }>> };
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

/** Resolve a named optionsSource to options. Unknown source → []. Never throws (best-effort).
 *  `opts.pluginId` (the node's plugin) scopes plugin-specific sources — connectors are filtered to
 *  the ones targeting that plugin, so a dhis2-sink node only lists dhis2-sink connectors. */
export async function resolveNodeOptions(
  source: string,
  deps: NodeOptionsDeps,
  opts?: { pluginId?: string },
): Promise<NodeOption[]> {
  try {
    switch (source) {
      case 'connectors': {
        const all = await deps.connectors.list();
        const scoped = opts?.pluginId ? all.filter((c) => c.pluginId === opts.pluginId) : all;
        return scoped.map((c) => ({ value: c.id, label: c.name }));
      }
      case 'datasets':
        return (await deps.datasets.list()).map((d) => ({ value: d.name, label: d.name }));
      case 'dhis2-mappings':
        return (await deps.dhis2Mappings()).map((m) => ({ value: m.id, label: m.name }));
      case 'fhir-resource-types':
        return FHIR_RESOURCE_TYPES.map((t) => ({ value: t, label: t }));
      case 'forms':
        return (await deps.forms.listPublished()).map((f) => ({ value: f.id, label: f.name }));
      default:
        return [];
    }
  } catch {
    return [];
  }
}
