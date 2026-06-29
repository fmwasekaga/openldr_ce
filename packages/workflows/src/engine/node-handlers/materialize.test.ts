import { describe, it, expect, vi } from 'vitest';
import { materializeHandler } from './materialize';
import { createContext } from '../execution-context';
import type { WorkflowServices } from '../services';
import type { WorkflowItem } from '../items';

describe('materializeHandler', () => {
  it('calls materializeDataset with fromItems-derived columns/rows and returns input unchanged', async () => {
    const materializeDataset = vi.fn(async () => ({ dataset: 'amr', rowCount: 2 }));
    const ctx = createContext(undefined, () => {}, [], undefined, { materializeDataset } as unknown as WorkflowServices);
    const input: WorkflowItem[] = [
      { json: { facility: 'f1', value: 2 } },
      { json: { facility: 'f2', value: 5 } },
    ];
    const out = await materializeHandler(
      { id: 'm1', type: 'action', data: { config: { datasetName: 'amr' } } },
      ctx,
      input,
    );
    expect(materializeDataset).toHaveBeenCalledWith(
      'amr',
      [{ key: 'facility', label: 'facility' }, { key: 'value', label: 'value' }],
      [{ facility: 'f1', value: 2 }, { facility: 'f2', value: 5 }],
      null,
    );
    expect(out).toBe(input); // same reference — passthrough
  });

  it('threads workflowId into the service call', async () => {
    const materializeDataset = vi.fn(async () => ({ dataset: 'ds', rowCount: 1 }));
    const ctx = createContext(undefined, () => {}, [], undefined, { materializeDataset } as unknown as WorkflowServices, 'wf-42');
    await materializeHandler(
      { id: 'm1', type: 'action', data: { config: { datasetName: 'ds' } } },
      ctx,
      [{ json: { x: 1 } }],
    );
    expect(materializeDataset).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.anything(), 'wf-42');
  });

  it('throws when datasetName is missing', async () => {
    const ctx = createContext(undefined, () => {}, [], undefined, {
      materializeDataset: vi.fn(),
    } as unknown as WorkflowServices);
    await expect(
      materializeHandler({ id: 'm1', type: 'action', data: { config: {} } }, ctx, []),
    ).rejects.toThrow(/datasetName is required/);
  });

  it('throws when services are absent', async () => {
    const ctx = createContext(undefined, () => {});
    await expect(
      materializeHandler({ id: 'm1', type: 'action', data: { config: { datasetName: 'x' } } }, ctx, []),
    ).rejects.toThrow(/requires server services/);
  });
});
