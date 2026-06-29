import type { WorkflowNodeKind, WorkflowPort, WorkflowConfigField } from '@openldr/marketplace';

/** Uniform node shape the builder will render (host + plugin nodes from one list). For a host node
 *  `source: 'host'` and `id` is the built-in node id; for a plugin node `source: 'plugin'`, `id` is
 *  `${pluginId}:${decl.id}` and `entrypoint` is the wasm export. */
export interface WorkflowNodeDescriptor {
  id: string;
  source: 'host' | 'plugin';
  pluginId?: string;
  label: string;
  kind: WorkflowNodeKind;
  description: string;
  /** wasm export invoked per run; plugin nodes only. */
  entrypoint?: string;
  ports: { inputs: WorkflowPort[]; outputs: WorkflowPort[] };
  capabilities: string[];
  config: WorkflowConfigField[];
}

/** A non-binary port. Inputs and outputs share the same wire shape in v1. */
const port = (name: string): WorkflowPort => ({ name, binary: false });

/** Built-in node handlers described as descriptors (no behaviour change to the handlers).
 *  Config is minimal in SP-1 — the builder integration that renders these arrives in SP-3. */
export const HOST_NODE_DESCRIPTORS: WorkflowNodeDescriptor[] = [
  // Sources
  { id: 'sql-query', source: 'host', label: 'SQL Query', kind: 'source', description: 'Query lab data via SQL.', ports: { inputs: [], outputs: [port('out')] }, capabilities: [], config: [] },
  { id: 'fhir-query', source: 'host', label: 'FHIR Query', kind: 'source', description: 'Read FHIR resources.', ports: { inputs: [], outputs: [port('out')] }, capabilities: [], config: [] },
  { id: 'http-request', source: 'host', label: 'HTTP Request', kind: 'source', description: 'Fetch from an allow-listed host.', ports: { inputs: [], outputs: [port('out')] }, capabilities: [], config: [] },
  { id: 'load-dataset', source: 'host', label: 'Load Dataset', kind: 'source', description: 'Load a materialized workflow dataset.', ports: { inputs: [], outputs: [port('out')] }, capabilities: [], config: [] },
  // Transforms
  { id: 'code', source: 'host', label: 'Code', kind: 'transform', description: 'Run sandboxed JavaScript.', ports: { inputs: [port('in')], outputs: [port('out')] }, capabilities: [], config: [] },
  { id: 'set', source: 'host', label: 'Set', kind: 'transform', description: 'Set or map fields.', ports: { inputs: [port('in')], outputs: [port('out')] }, capabilities: [], config: [] },
  { id: 'merge', source: 'host', label: 'Merge', kind: 'transform', description: 'Merge inputs.', ports: { inputs: [port('in')], outputs: [port('out')] }, capabilities: [], config: [] },
  { id: 'log', source: 'host', label: 'Log', kind: 'transform', description: 'Log items.', ports: { inputs: [port('in')], outputs: [port('out')] }, capabilities: [], config: [] },
  { id: 'if', source: 'host', label: 'If', kind: 'transform', description: 'Branch on a condition.', ports: { inputs: [port('in')], outputs: [port('true'), port('false')] }, capabilities: [], config: [] },
  { id: 'filter', source: 'host', label: 'Filter', kind: 'transform', description: 'Filter items by a condition.', ports: { inputs: [port('in')], outputs: [port('out')] }, capabilities: [], config: [] },
  // Sinks
  { id: 'materialize-dataset', source: 'host', label: 'Materialize Dataset', kind: 'sink', description: 'Persist items as a dataset.', ports: { inputs: [port('in')], outputs: [] }, capabilities: [], config: [] },
  { id: 'export-artifact', source: 'host', label: 'Export Artifact', kind: 'sink', description: 'Export items to CSV/XLSX/PDF.', ports: { inputs: [port('in')], outputs: [] }, capabilities: [], config: [] },
  {
    id: 'dhis2-push', source: 'host', label: 'DHIS2 Push', kind: 'sink',
    description: 'Push aggregate rows to DHIS2 via a mapping.',
    ports: { inputs: [port('in')], outputs: [] }, capabilities: [],
    config: [
      { key: 'mappingId', label: 'Mapping', type: 'select', optionsSource: 'dhis2-mappings', required: true },
      { key: 'period', label: 'Period', type: 'text', required: true },
      { key: 'dryRun', label: 'Dry run', type: 'boolean', required: false, default: false },
    ],
  },
];
