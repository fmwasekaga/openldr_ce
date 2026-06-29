import { describe, it, expect } from 'vitest';
import { workflowNodeDeclSchema, parseWorkflowNodeDecls } from './workflow-node';

const VALID = {
  id: 'aggregate-push',
  label: 'DHIS2 Aggregate Push',
  kind: 'sink',
  entrypoint: 'wf_push_aggregate',
  ports: { inputs: [{ name: 'in' }], outputs: [] },
  capabilities: ['net-egress', 'host:connectors'],
  config: [
    { key: 'connectorId', label: 'Connector', type: 'select', optionsSource: 'connectors', required: true },
    { key: 'dryRun', label: 'Dry run', type: 'boolean', default: false },
  ],
};

describe('workflowNodeDeclSchema', () => {
  it('parses a valid declaration and applies field defaults', () => {
    const d = workflowNodeDeclSchema.parse(VALID);
    expect(d.kind).toBe('sink');
    expect(d.entrypoint).toBe('wf_push_aggregate');
    expect(d.capabilities).toEqual(['net-egress', 'host:connectors']);
    // field defaults
    expect(d.description).toBe('');
    expect(d.config[0].required).toBe(true);
    expect(d.config[1].required).toBe(false);
    expect(d.ports.inputs[0].binary).toBe(false);
  });

  it('defaults ports/capabilities/config when omitted', () => {
    const d = workflowNodeDeclSchema.parse({ id: 's', label: 'S', kind: 'source', entrypoint: 'convert' });
    expect(d.ports).toEqual({ inputs: [], outputs: [] });
    expect(d.capabilities).toEqual([]);
    expect(d.config).toEqual([]);
  });

  it('rejects an unknown kind', () => {
    expect(() => workflowNodeDeclSchema.parse({ ...VALID, kind: 'gateway' })).toThrow();
  });

  it('rejects an unknown config field type', () => {
    const bad = { ...VALID, config: [{ key: 'x', label: 'X', type: 'datetime' }] };
    expect(() => workflowNodeDeclSchema.parse(bad)).toThrow();
  });

  it('rejects a missing entrypoint', () => {
    const { entrypoint, ...rest } = VALID;
    expect(() => workflowNodeDeclSchema.parse(rest)).toThrow();
  });

  it('parseWorkflowNodeDecls parses an array', () => {
    const arr = parseWorkflowNodeDecls([VALID]);
    expect(arr).toHaveLength(1);
    expect(arr[0].id).toBe('aggregate-push');
  });
});

describe('workflowNodeDeclSchema abi', () => {
  it('defaults abi to "items"', () => {
    const d = workflowNodeDeclSchema.parse({ id: 'n', label: 'N', kind: 'transform', entrypoint: 'e' });
    expect(d.abi).toBe('items');
    expect(d.binaryField).toBeUndefined();
  });
  it('accepts abi:"bytes" + binaryField', () => {
    const d = workflowNodeDeclSchema.parse({ id: 'c', label: 'C', kind: 'transform', entrypoint: 'wf_convert', abi: 'bytes', binaryField: 'file' });
    expect(d.abi).toBe('bytes');
    expect(d.binaryField).toBe('file');
  });
  it('rejects an unknown abi', () => {
    expect(() => workflowNodeDeclSchema.parse({ id: 'n', label: 'N', kind: 'transform', entrypoint: 'e', abi: 'stream' })).toThrow();
  });
});

describe('workflowConfigFieldSchema detailSource', () => {
  it('accepts a detailSource on a config field', () => {
    const d = workflowNodeDeclSchema.parse({ id: 'n', label: 'N', kind: 'sink', entrypoint: 'wf_push',
      config: [{ key: 'mappingId', label: 'Mapping', type: 'select', optionsSource: 'dhis2-mappings', detailSource: 'dhis2-mapping' }] });
    expect(d.config[0].detailSource).toBe('dhis2-mapping');
  });
  it('defaults detailSource to undefined', () => {
    const d = workflowNodeDeclSchema.parse({ id: 'n', label: 'N', kind: 'sink', entrypoint: 'e', config: [{ key: 'k', label: 'K', type: 'text' }] });
    expect(d.config[0].detailSource).toBeUndefined();
  });
});
