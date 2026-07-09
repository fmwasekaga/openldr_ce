import { describe, it, expect, vi, beforeEach } from 'vitest';

const { authFetch } = vi.hoisted(() => ({
  authFetch: vi.fn(async (_url: string, _init?: RequestInit) => ({ ok: true, status: 200, json: async (): Promise<unknown> => [] })),
}));
vi.mock('../api', () => ({ authFetch }));

import { listReportCategories, saveReportCategories, type ReportCategory } from './reportCategoriesApi';

const SAMPLE: ReportCategory[] = [
  { id: 'amr', label: 'AMR / Surveillance', order: 0 },
  { id: 'operational', label: 'Operational', order: 1 },
];

describe('reportCategoriesApi', () => {
  beforeEach(() => authFetch.mockClear());

  it('lists via GET /api/report-categories', async () => {
    authFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async (): Promise<unknown> => SAMPLE });
    const result = await listReportCategories();
    expect(authFetch).toHaveBeenCalledWith('/api/report-categories');
    expect(result).toEqual(SAMPLE);
  });

  it('throws when the list request fails', async () => {
    authFetch.mockResolvedValueOnce({ ok: false, status: 500, json: async (): Promise<unknown> => ({}) });
    // NOTE: `.rejects.toThrow(regex|string)` is unreliable in this repo's vitest setup (known
    // duplicate-vitest chai double-patch flake, see [[studio-test-vitest-dedupe-flake]]) — assert
    // via a manual catch instead.
    let caught: unknown;
    try {
      await listReportCategories();
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toContain('500');
  });

  it('saves the full replacement list via PUT', async () => {
    authFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async (): Promise<unknown> => SAMPLE });
    const result = await saveReportCategories(SAMPLE);
    const [url, init] = authFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/report-categories');
    expect(init?.method).toBe('PUT');
    expect(JSON.parse(init?.body as string)).toEqual(SAMPLE);
    expect(result).toEqual(SAMPLE);
  });

  it('throws when the save request fails (e.g. 403 for a non-manager)', async () => {
    authFetch.mockResolvedValueOnce({ ok: false, status: 403, json: async (): Promise<unknown> => ({}) });
    let caught: unknown;
    try {
      await saveReportCategories(SAMPLE);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toContain('403');
  });
});
