import { describe, it, expect, vi } from 'vitest';
import { formValidateHandler } from './form-validate';
import { persistStoreHandler } from './persist-store';
import { createContext } from '../execution-context';
import type { WorkflowServices } from '../services';
import type { WorkflowItem } from '../items';

describe('formValidateHandler', () => {
  it('delegates to services.validateForm and stores meta', async () => {
    const validateForm = vi.fn(async ({ formId, items }: { formId: string; items: WorkflowItem[] }) => ({
      items: [{ json: { resourceType: 'Observation' } }],
      meta: { formId, validated: items.length, invalid: [] },
    }));
    const ctx = createContext(undefined, () => {}, [], undefined, { validateForm } as unknown as WorkflowServices);
    const out = await formValidateHandler(
      { id: 'fv', type: 'action', data: { action: 'form-validate', config: { formId: 'form-1' } } },
      ctx,
      [{ json: { name: 'Ada' } }],
    );
    expect(validateForm).toHaveBeenCalledWith({ formId: 'form-1', items: [{ json: { name: 'Ada' } }] });
    expect(out).toEqual([{ json: { resourceType: 'Observation' } }]);
    expect(ctx.nodeMeta['fv']).toEqual({ formId: 'form-1', validated: 1, invalid: [] });
  });

  it('throws when formId is missing', async () => {
    const ctx = createContext(undefined, () => {}, [], undefined, { validateForm: vi.fn() } as unknown as WorkflowServices);
    await expect(
      formValidateHandler({ id: 'fv', type: 'action', data: { action: 'form-validate', config: {} } }, ctx, []),
    ).rejects.toThrow(/formId is required/);
  });

  it('throws when services are absent', async () => {
    const ctx = createContext(undefined, () => {}, [], undefined, undefined);
    await expect(
      formValidateHandler({ id: 'fv', type: 'action', data: { action: 'form-validate', config: { formId: 'x' } } }, ctx, []),
    ).rejects.toThrow(/requires server services/);
  });
});

describe('persistStoreHandler', () => {
  it('delegates to services.persistStore, returns input, stores meta', async () => {
    const persistStore = vi.fn(async ({ items, source }: { items: WorkflowItem[]; source?: string }) => ({
      items,
      meta: { persisted: items.length, flattened: { written: items.length, skipped: 0, degraded: 0 }, resourceTypes: ['Observation'], source },
    }));
    const ctx = createContext(undefined, () => {}, [], undefined, { persistStore } as unknown as WorkflowServices);
    const input: WorkflowItem[] = [{ json: { resourceType: 'Observation' } }];
    const out = await persistStoreHandler(
      { id: 'ps', type: 'action', data: { action: 'persist-store', config: { source: 'amr' } } },
      ctx,
      input,
    );
    expect(persistStore).toHaveBeenCalledWith({ items: input, source: 'amr' });
    expect(out).toBe(input);
    expect((ctx.nodeMeta['ps'] as { persisted: number }).persisted).toBe(1);
  });

  it('throws when services are absent', async () => {
    const ctx = createContext(undefined, () => {}, [], undefined, undefined);
    await expect(
      persistStoreHandler({ id: 'ps', type: 'action', data: { action: 'persist-store', config: {} } }, ctx, []),
    ).rejects.toThrow(/requires server services/);
  });
});
