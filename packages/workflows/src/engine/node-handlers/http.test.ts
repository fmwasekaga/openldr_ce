import { describe, it, expect, vi } from 'vitest';
import { httpHandler } from './http';
import { createContext } from '../execution-context';
import type { WorkflowServices } from '../services';

const mockResponse = { status: 200, headers: { 'content-type': 'application/json' }, data: { ok: true } };

describe('httpHandler', () => {
  it('calls httpFetch and wraps response as a single item', async () => {
    const httpFetch = vi.fn(async () => mockResponse);
    const ctx = createContext(undefined, () => {}, [], undefined, { httpFetch } as unknown as WorkflowServices);
    const out = await httpHandler(
      { id: 'n1', type: 'action', data: { config: { url: 'https://example.com/api', method: 'GET' } } },
      ctx,
      [],
    );
    expect(httpFetch).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://example.com/api', method: 'GET' }));
    expect(out).toEqual([{ json: { status: 200, headers: { 'content-type': 'application/json' }, data: { ok: true } } }]);
  });

  it('resolves templates in url against input items', async () => {
    const httpFetch = vi.fn(async () => mockResponse);
    const ctx = createContext(undefined, () => {}, [], undefined, { httpFetch } as unknown as WorkflowServices);
    await httpHandler(
      { id: 'n1', type: 'action', data: { config: { url: 'https://api.example.com/{{ $json.path }}', method: 'GET' } } },
      ctx,
      [{ json: { path: 'patients' } }],
    );
    expect(httpFetch).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://api.example.com/patients' }));
  });

  it('parses string headers as JSON', async () => {
    const httpFetch = vi.fn(async () => mockResponse);
    const ctx = createContext(undefined, () => {}, [], undefined, { httpFetch } as unknown as WorkflowServices);
    await httpHandler(
      {
        id: 'n1', type: 'action',
        data: { config: { url: 'https://example.com', method: 'GET', headers: '{"X-Token":"abc"}' } },
      },
      ctx,
      [],
    );
    expect(httpFetch).toHaveBeenCalledWith(expect.objectContaining({ headers: { 'X-Token': 'abc' } }));
  });

  it('throws when services are absent', async () => {
    const ctx = createContext(undefined, () => {});
    await expect(
      httpHandler({ id: 'n1', type: 'action', data: { config: { url: 'https://x.com' } } }, ctx, []),
    ).rejects.toThrow(/requires server services/);
  });
});
