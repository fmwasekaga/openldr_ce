import { describe, it, expect } from 'vitest';
import { addCustomColumn, updateCustomColumn, removeCustomColumn, uniqueCustomKey, customColumnKind, deriveCustomLabel } from './customColumns.model';
import { setDimensionPatch, type BuilderQuery } from './builderForm.model';

const q0 = () => ({ mode: 'builder' as const, model: 'service_requests', metric: { key: 'count', agg: 'count', label: 'Count' }, filters: [] }) as BuilderQuery;
const col = { key: 'custom', label: 'S/P', expr: { kind: 'concat' as const, parts: [{ type: 'field' as const, dimension: 'status' }] } };

describe('customColumns.model', () => {
  it('customColumnKind maps concat→string, arithmetic→number', () => {
    expect(customColumnKind({ kind: 'concat', parts: [{ type: 'string', value: 'x' }] })).toBe('string');
    expect(customColumnKind({ kind: 'arithmetic', op: '+', left: { type: 'number', value: 1 }, right: { type: 'number', value: 2 } })).toBe('number');
  });

  it('uniqueCustomKey avoids collisions', () => {
    expect(uniqueCustomKey([])).toBe('custom');
    expect(uniqueCustomKey([{ key: 'custom', label: '', expr: { kind: 'concat', parts: [] } }])).toBe('custom-2');
  });

  it('deriveCustomLabel builds a readable default', () => {
    const dimLabel = (k: string) => ({ status: 'Status', priority: 'Priority' }[k] ?? k);
    expect(deriveCustomLabel({ kind: 'concat', parts: [{ type: 'field', dimension: 'status' }, { type: 'string', value: '/' }, { type: 'field', dimension: 'priority' }] }, dimLabel)).toBe('Status + "/" + Priority');
    expect(deriveCustomLabel({ kind: 'arithmetic', op: '/', left: { type: 'field', dimension: 'status' }, right: { type: 'number', value: 1000 } }, dimLabel)).toBe('Status / 1000');
  });

  it('addCustomColumn appends and dedupes by key', () => {
    const a = addCustomColumn(q0(), col);
    expect(a.customColumns).toEqual([col]);
    expect(addCustomColumn(a, col).customColumns).toEqual([col]); // no duplicate
  });

  it('updateCustomColumn patches one column by key', () => {
    const a = addCustomColumn(q0(), col);
    const b = updateCustomColumn(a, 'custom', { label: 'Renamed' });
    expect(b.customColumns![0].label).toBe('Renamed');
  });

  it('removeCustomColumn drops it and orphan-cleans a group-by that referenced it', () => {
    let q = addCustomColumn(q0(), col);
    q = setDimensionPatch(q, 'custom');
    const next = removeCustomColumn(q, 'custom');
    expect(next.customColumns).toEqual([]);
    expect(next.dimension).toBeUndefined();
  });
});
