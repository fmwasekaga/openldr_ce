import { describe, it, expect, vi } from 'vitest';
import { materializeHandler } from './materialize';
import { exportHandler } from './export';
import { createContext } from '../execution-context';
import type { WorkflowServices } from '../services';
import type { WorkflowItem } from '../items';

const base: WorkflowServices = {
  runSql: vi.fn(),
  fhirQuery: vi.fn(),
  httpFetch: vi.fn(),
  materializeDataset: vi.fn(async (name, _c, rows) => ({ dataset: name, rowCount: rows.length })),
  exportArtifact: vi.fn(async (i) => ({ objectKey: `k/${i.format}`, format: i.format, byteSize: 10 })),
  loadDataset: async () => ({ columns: [], rows: [] }),
} as never;

const ctxWith = (svc?: Partial<WorkflowServices>, workflowId = 'w1') =>
  createContext(undefined, () => {}, [], undefined, svc as WorkflowServices, workflowId);

describe('sink handlers', () => {
  it('materialize delegates with name, rows, and workflowId', async () => {
    const ctx = ctxWith(base);
    const input: WorkflowItem[] = [{ json: { a: 1 } }, { json: { a: 2 } }];
    const out = await materializeHandler(
      { id: 'm', type: 'action', data: { action: 'materialize-dataset', config: { datasetName: 'amr' } } },
      ctx,
      input,
    );
    // handler returns input items unchanged
    expect(out).toEqual(input);
    expect(base.materializeDataset).toHaveBeenCalledWith('amr', [{ key: 'a', label: 'a' }], [{ a: 1 }, { a: 2 }], 'w1');
  });

  it('export delegates with the chosen format and attaches BinaryRef to first item', async () => {
    const ctx = ctxWith(base);
    const input: WorkflowItem[] = [{ json: { a: 1 } }];
    const out = await exportHandler(
      { id: 'e', type: 'action', data: { action: 'export-artifact', config: { format: 'csv' } } },
      ctx,
      input,
    );
    expect(base.exportArtifact).toHaveBeenCalledWith(
      expect.objectContaining({ format: 'csv', rows: [{ a: 1 }] }),
    );
    expect(out).toHaveLength(1);
    expect(out[0].json).toEqual({ a: 1 });
    expect(out[0].binary!.export).toEqual({ objectKey: 'k/csv', contentType: 'text/csv', fileName: 'export.csv', byteSize: 10 });
  });

  it('each throws when services are absent', async () => {
    const ctx = createContext(undefined, () => {});
    await expect(
      materializeHandler(
        { id: 'm', type: 'action', data: { config: { datasetName: 'x' } } },
        ctx,
        [],
      ),
    ).rejects.toThrow(/requires server services/);
  });
});
