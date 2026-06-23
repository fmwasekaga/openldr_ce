import { describe, it, expect, vi } from 'vitest';
import { materializeHandler } from './materialize';
import { exportHandler } from './export';
import { dhis2PushHandler } from './dhis2-push';
import { createContext } from '../execution-context';
import type { WorkflowServices } from '../services';

const base: WorkflowServices = {
  runSql: vi.fn(),
  fhirQuery: vi.fn(),
  httpFetch: vi.fn(),
  materializeDataset: vi.fn(async (name, _c, rows) => ({ dataset: name, rowCount: rows.length })),
  exportArtifact: vi.fn(async (i) => ({ objectKey: `k/${i.format}`, format: i.format, byteSize: 10 })),
  dhis2Push: vi.fn(async () => ({ status: 'OK', imported: 1 })),
} as never;

const ctxWith = (svc?: Partial<WorkflowServices>, workflowId = 'w1') =>
  createContext(undefined, () => {}, [], undefined, svc as WorkflowServices, workflowId);

describe('sink handlers', () => {
  it('materialize delegates with name, rows, and workflowId', async () => {
    const ctx = ctxWith(base);
    const out = await materializeHandler(
      { id: 'm', type: 'action', data: { action: 'materialize-dataset', config: { datasetName: 'amr' } } },
      ctx,
      { columns: [], rows: [{ a: 1 }, { a: 2 }] },
    );
    expect(out).toEqual({ dataset: 'amr', rowCount: 2 });
    expect(base.materializeDataset).toHaveBeenCalledWith('amr', [], [{ a: 1 }, { a: 2 }], 'w1');
  });

  it('export delegates with the chosen format', async () => {
    const ctx = ctxWith(base);
    const out = await exportHandler(
      { id: 'e', type: 'action', data: { action: 'export-artifact', config: { format: 'csv' } } },
      ctx,
      { columns: [{ key: 'a', label: 'A' }], rows: [{ a: 1 }] },
    );
    expect((out as { format: string }).format).toBe('csv');
  });

  it('dhis2-push delegates when available', async () => {
    const ctx = ctxWith(base);
    const out = await dhis2PushHandler(
      { id: 'd', type: 'action', data: { action: 'dhis2-push', config: { mappingId: 'map1', period: '202401' } } },
      ctx,
      undefined,
    );
    expect((out as { status: string }).status).toBe('OK');
  });

  it('dhis2-push throws when capability is absent', async () => {
    const ctx = ctxWith({ ...base, dhis2Push: undefined });
    await expect(
      dhis2PushHandler(
        { id: 'd', type: 'action', data: { config: { mappingId: 'm', period: 'p' } } },
        ctx,
        undefined,
      ),
    ).rejects.toThrow(/not available/);
  });

  it('each throws when services are absent', async () => {
    const ctx = createContext(undefined, () => {});
    await expect(
      materializeHandler(
        { id: 'm', type: 'action', data: { config: { datasetName: 'x' } } },
        ctx,
        { rows: [] },
      ),
    ).rejects.toThrow(/requires server services/);
  });
});
