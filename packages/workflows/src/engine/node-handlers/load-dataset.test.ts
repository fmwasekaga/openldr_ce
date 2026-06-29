import { describe, it, expect, vi } from 'vitest';
import { loadDatasetHandler } from './load-dataset';
import { createContext } from '../execution-context';
import type { WorkflowServices } from '../services';

describe('loadDatasetHandler', () => {
  it('delegates to services.loadDataset and returns items', async () => {
    const loadDataset = vi.fn(async (name: string) => ({
      columns: [{ key: 'a', label: 'A' }],
      rows: [{ a: 1, name }],
    }));
    const ctx = createContext(undefined, () => {}, [], undefined, { loadDataset } as unknown as WorkflowServices);
    const out = await loadDatasetHandler(
      { id: 'l', type: 'action', data: { action: 'load-dataset', config: { datasetName: 'amr' } } },
      ctx,
      [],
    );
    expect(loadDataset).toHaveBeenCalledWith('amr');
    expect(out).toEqual([{ json: { a: 1, name: 'amr' } }]);
  });

  it('throws without a datasetName', async () => {
    const ctx = createContext(undefined, () => {}, [], undefined, {
      loadDataset: vi.fn(),
    } as unknown as WorkflowServices);
    await expect(
      loadDatasetHandler({ id: 'l', type: 'action', data: { config: {} } }, ctx, []),
    ).rejects.toThrow(/datasetName is required/);
  });

  it('throws when services are absent', async () => {
    const ctx = createContext(undefined, () => {});
    await expect(
      loadDatasetHandler({ id: 'l', type: 'action', data: { config: { datasetName: 'x' } } }, ctx, []),
    ).rejects.toThrow(/requires server services/);
  });
});
