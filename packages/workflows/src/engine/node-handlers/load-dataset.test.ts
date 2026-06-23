import { describe, it, expect, vi } from 'vitest';
import { loadDatasetHandler } from './load-dataset';
import { createContext } from '../execution-context';
import type { WorkflowServices } from '../services';

const services = { loadDataset: vi.fn(async (name: string) => ({ columns: [{ key: 'a', label: 'A' }], rows: [{ a: 1, name }] })) } as unknown as WorkflowServices;

describe('loadDatasetHandler', () => {
  it('delegates to services.loadDataset', async () => {
    const ctx = createContext(undefined, () => {}, [], undefined, services);
    const out = await loadDatasetHandler({ id: 'l', type: 'action', data: { action: 'load-dataset', config: { datasetName: 'amr' } } }, ctx, undefined);
    expect((out as { rows: { name: string }[] }).rows[0].name).toBe('amr');
  });
  it('throws without a datasetName', async () => {
    const ctx = createContext(undefined, () => {}, [], undefined, services);
    await expect(loadDatasetHandler({ id: 'l', type: 'action', data: { config: {} } }, ctx, undefined)).rejects.toThrow(/datasetName is required/);
  });
  it('throws when services are absent', async () => {
    const ctx = createContext(undefined, () => {});
    await expect(loadDatasetHandler({ id: 'l', type: 'action', data: { config: { datasetName: 'x' } } }, ctx, undefined)).rejects.toThrow(/requires server services/);
  });
});
