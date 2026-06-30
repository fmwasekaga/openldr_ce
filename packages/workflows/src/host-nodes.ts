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
  /** Wire ABI for plugin nodes ('items' default, 'bytes' = binary converter). Host nodes omit it. */
  abi?: 'items' | 'bytes';
  /** For abi:'bytes' — the binary field name on the input item (default 'file'). */
  binaryField?: string;
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
  { id: 'form-validate', source: 'host', label: 'Form Validate', kind: 'transform', description: 'Validate items against a form and emit FHIR resources.', ports: { inputs: [port('in')], outputs: [port('out')] }, capabilities: [], config: [{ key: 'formId', label: 'Form', type: 'select', required: true, optionsSource: 'forms' }] },
  { id: 'sort', source: 'host', label: 'Sort', kind: 'transform', description: 'Order items by a field.', ports: { inputs: [port('in')], outputs: [port('out')] }, capabilities: [], config: [{ key: 'field', label: 'Sort field', type: 'text', required: true }, { key: 'order', label: 'Order', type: 'select', required: false, options: [{ value: 'asc', label: 'Ascending' }, { value: 'desc', label: 'Descending' }] }] },
  { id: 'limit', source: 'host', label: 'Limit', kind: 'transform', description: 'Keep the first or last N items.', ports: { inputs: [port('in')], outputs: [port('out')] }, capabilities: [], config: [{ key: 'maxItems', label: 'Max items', type: 'number', required: true }, { key: 'keep', label: 'Keep', type: 'select', required: false, options: [{ value: 'first', label: 'First' }, { value: 'last', label: 'Last' }] }] },
  { id: 'remove-duplicates', source: 'host', label: 'Remove Duplicates', kind: 'transform', description: 'Drop duplicate items.', ports: { inputs: [port('in')], outputs: [port('out')] }, capabilities: [], config: [{ key: 'field', label: 'Dedupe by field (blank = whole item)', type: 'text', required: false }] },
  { id: 'rename-keys', source: 'host', label: 'Rename Keys', kind: 'transform', description: 'Rename object fields.', ports: { inputs: [port('in')], outputs: [port('out')] }, capabilities: [], config: [{ key: 'renames', label: 'Renames ([{ "from": "old", "to": "new" }])', type: 'json', required: false }] },
  { id: 'split-out', source: 'host', label: 'Split Out', kind: 'transform', description: 'Split an array field into items.', ports: { inputs: [port('in')], outputs: [port('out')] }, capabilities: [], config: [{ key: 'field', label: 'Field to split out', type: 'text', required: true }] },
  { id: 'aggregate', source: 'host', label: 'Aggregate', kind: 'transform', description: 'Collect items into one.', ports: { inputs: [port('in')], outputs: [port('out')] }, capabilities: [], config: [{ key: 'field', label: 'Field to aggregate (blank = whole item)', type: 'text', required: false }, { key: 'outputField', label: 'Output field', type: 'text', required: false }] },
  { id: 'summarize', source: 'host', label: 'Summarize', kind: 'transform', description: 'Sum, avg, min, max, count.', ports: { inputs: [port('in')], outputs: [port('out')] }, capabilities: [], config: [{ key: 'groupBy', label: 'Group by field (blank = all)', type: 'text', required: false }, { key: 'field', label: 'Value field', type: 'text', required: false }, { key: 'operation', label: 'Operation', type: 'select', required: false, options: [{ value: 'count', label: 'Count' }, { value: 'sum', label: 'Sum' }, { value: 'avg', label: 'Average' }, { value: 'min', label: 'Min' }, { value: 'max', label: 'Max' }] }] },
  { id: 'date-time', source: 'host', label: 'Date & Time', kind: 'transform', description: 'Format, parse, offset dates.', ports: { inputs: [port('in')], outputs: [port('out')] }, capabilities: [], config: [{ key: 'operation', label: 'Operation', type: 'select', required: false, options: [{ value: 'format', label: 'Format' }, { value: 'now', label: 'Now' }, { value: 'add', label: 'Add' }, { value: 'subtract', label: 'Subtract' }] }, { key: 'field', label: 'Date field', type: 'text', required: false }, { key: 'amount', label: 'Amount', type: 'number', required: false }, { key: 'unit', label: 'Unit', type: 'select', required: false, options: [{ value: 'seconds', label: 'Seconds' }, { value: 'minutes', label: 'Minutes' }, { value: 'hours', label: 'Hours' }, { value: 'days', label: 'Days' }] }, { key: 'outputField', label: 'Output field', type: 'text', required: false }] },
  { id: 'compare-datasets', source: 'host', label: 'Compare Datasets', kind: 'transform', description: 'Diff two item lists by a key.', ports: { inputs: [port('in')], outputs: [port('out')] }, capabilities: [], config: [{ key: 'key', label: 'Match by field', type: 'text', required: true }] },
  // Sinks
  { id: 'materialize-dataset', source: 'host', label: 'Materialize Dataset', kind: 'sink', description: 'Persist items as a dataset.', ports: { inputs: [port('in')], outputs: [] }, capabilities: [], config: [] },
  { id: 'export-artifact', source: 'host', label: 'Export Artifact', kind: 'sink', description: 'Export items to CSV/XLSX/PDF.', ports: { inputs: [port('in')], outputs: [] }, capabilities: [], config: [] },
  { id: 'persist-store', source: 'host', label: 'Persist Store', kind: 'sink', description: 'Persist FHIR resources and emit a data.persisted event.', ports: { inputs: [port('in')], outputs: [] }, capabilities: [], config: [{ key: 'source', label: 'Source system', type: 'text', required: false }] },
];
