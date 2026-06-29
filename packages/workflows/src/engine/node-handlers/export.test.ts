import { describe, it, expect, vi } from 'vitest';
import { exportHandler } from './export';
import { createContext } from '../execution-context';
import type { WorkflowServices } from '../services';
import type { WorkflowItem } from '../items';

describe('exportHandler', () => {
  it('calls exportArtifact with fromItems-derived columns/rows and attaches BinaryRef to first item', async () => {
    const exportArtifact = vi.fn(async () => ({ objectKey: 'blob/123.csv', format: 'csv', byteSize: 42 }));
    const ctx = createContext(undefined, () => {}, [], undefined, { exportArtifact } as unknown as WorkflowServices);
    const input: WorkflowItem[] = [
      { json: { facility: 'f1', value: 2 } },
      { json: { facility: 'f2', value: 5 } },
    ];
    const out = await exportHandler(
      { id: 'e1', type: 'action', data: { label: 'My Export', config: { format: 'csv' } } },
      ctx,
      input,
    );
    expect(exportArtifact).toHaveBeenCalledWith({
      format: 'csv',
      filename: undefined,
      title: 'My Export',
      columns: [{ key: 'facility', label: 'facility' }, { key: 'value', label: 'value' }],
      rows: [{ facility: 'f1', value: 2 }, { facility: 'f2', value: 5 }],
    });
    expect(out).toHaveLength(2);
    expect(out[0].json).toEqual({ facility: 'f1', value: 2 });
    expect(out[0].binary!.export).toEqual({ objectKey: 'blob/123.csv', contentType: 'text/csv', fileName: 'export.csv', byteSize: 42 });
    // second item is unchanged
    expect(out[1]).toEqual({ json: { facility: 'f2', value: 5 } });
  });

  it('defaults format to csv and uses fallback title', async () => {
    const exportArtifact = vi.fn(async () => ({ objectKey: 'k', format: 'csv', byteSize: 0 }));
    const ctx = createContext(undefined, () => {}, [], undefined, { exportArtifact } as unknown as WorkflowServices);
    await exportHandler(
      { id: 'e1', type: 'action', data: { config: {} } },
      ctx,
      [{ json: { a: 1 } }],
    );
    expect(exportArtifact).toHaveBeenCalledWith(expect.objectContaining({ format: 'csv', title: 'Workflow Export' }));
  });

  it('passes through a custom filename', async () => {
    const exportArtifact = vi.fn(async () => ({ objectKey: 'k', format: 'xlsx', byteSize: 0 }));
    const ctx = createContext(undefined, () => {}, [], undefined, { exportArtifact } as unknown as WorkflowServices);
    await exportHandler(
      { id: 'e1', type: 'action', data: { config: { format: 'xlsx', filename: 'report.xlsx' } } },
      ctx,
      [{ json: { n: 1 } }],
    );
    expect(exportArtifact).toHaveBeenCalledWith(expect.objectContaining({ format: 'xlsx', filename: 'report.xlsx' }));
  });

  it('throws when services are absent', async () => {
    const ctx = createContext(undefined, () => {});
    await expect(
      exportHandler({ id: 'e1', type: 'action', data: { config: { format: 'csv' } } }, ctx, []),
    ).rejects.toThrow(/requires server services/);
  });

  it('attaches the produced file as a BinaryRef on the first output item', async () => {
    const ctx = createContext(undefined, () => {});
    ctx.services = { exportArtifact: vi.fn().mockResolvedValue({ objectKey: 'workflow-artifacts/u/export.csv', format: 'csv', byteSize: 12 }) } as never;
    const out = await exportHandler({ id: 'e', type: 'action', data: { action: 'export-artifact', config: { format: 'csv' } } } as never, ctx, [{ json: { a: 1 } }]);
    expect(out).toHaveLength(1);
    expect(out[0].json).toEqual({ a: 1 });
    expect(out[0].binary!.export).toEqual({ objectKey: 'workflow-artifacts/u/export.csv', contentType: 'text/csv', fileName: 'export.csv', byteSize: 12 });
  });

  it('emits a single item carrying the BinaryRef when input is empty', async () => {
    const ctx = createContext(undefined, () => {});
    ctx.services = { exportArtifact: vi.fn().mockResolvedValue({ objectKey: 'workflow-artifacts/u/export.csv', format: 'csv', byteSize: 0 }) } as never;
    const out = await exportHandler({ id: 'e', type: 'action', data: { config: { format: 'csv' } } } as never, ctx, []);
    expect(out).toHaveLength(1);
    expect(out[0].binary!.export.objectKey).toBe('workflow-artifacts/u/export.csv');
  });
});
