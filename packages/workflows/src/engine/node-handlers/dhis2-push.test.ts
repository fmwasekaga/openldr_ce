import { describe, it, expect, vi } from 'vitest';
import { dhis2PushHandler } from './dhis2-push';
import { createContext } from '../execution-context';
import type { WorkflowServices } from '../services';
import type { WorkflowItem } from '../items';

describe('dhis2PushHandler', () => {
  it('calls dhis2Push with config fields and returns input unchanged', async () => {
    const dhis2Push = vi.fn(async () => ({ imported: 1, updated: 0 }));
    const ctx = createContext(undefined, () => {}, [], undefined, { dhis2Push } as unknown as WorkflowServices);
    const input: WorkflowItem[] = [{ json: { facility: 'f1', value: 2 } }];
    const out = await dhis2PushHandler(
      {
        id: 'd1', type: 'action',
        data: { config: { mappingId: 'map-01', period: '202401', dryRun: false } },
      },
      ctx,
      input,
    );
    expect(dhis2Push).toHaveBeenCalledWith({ mappingId: 'map-01', period: '202401', dryRun: false });
    expect(out).toBe(input); // passthrough
  });

  it('passes dryRun: true when configured', async () => {
    const dhis2Push = vi.fn(async () => ({}));
    const ctx = createContext(undefined, () => {}, [], undefined, { dhis2Push } as unknown as WorkflowServices);
    await dhis2PushHandler(
      { id: 'd1', type: 'action', data: { config: { mappingId: 'm1', period: '202401', dryRun: true } } },
      ctx,
      [],
    );
    expect(dhis2Push).toHaveBeenCalledWith(expect.objectContaining({ dryRun: true }));
  });

  it('throws when dhis2Push is not on services', async () => {
    // services present but no dhis2Push
    const ctx = createContext(undefined, () => {}, [], undefined, {} as unknown as WorkflowServices);
    await expect(
      dhis2PushHandler(
        { id: 'd1', type: 'action', data: { config: { mappingId: 'm1', period: '202401' } } },
        ctx,
        [],
      ),
    ).rejects.toThrow(/DHIS2 push not available/);
  });

  it('throws when services are absent', async () => {
    const ctx = createContext(undefined, () => {});
    await expect(
      dhis2PushHandler(
        { id: 'd1', type: 'action', data: { config: { mappingId: 'm1', period: '202401' } } },
        ctx,
        [],
      ),
    ).rejects.toThrow(/DHIS2 push not available/);
  });

  it('throws when mappingId or period is missing', async () => {
    const dhis2Push = vi.fn(async () => ({}));
    const ctx = createContext(undefined, () => {}, [], undefined, { dhis2Push } as unknown as WorkflowServices);
    await expect(
      dhis2PushHandler(
        { id: 'd1', type: 'action', data: { config: { mappingId: '', period: '202401' } } },
        ctx,
        [],
      ),
    ).rejects.toThrow(/mappingId and period are required/);
  });
});
