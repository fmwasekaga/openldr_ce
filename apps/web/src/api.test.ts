import { describe, expect, it, vi } from 'vitest';
import { createCodingSystem } from './api';

describe('api error handling', () => {
  it('includes server error messages for failed JSON responses', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ error: 'duplicate code system url: http://snomed.info/sct' }),
      { status: 409, headers: { 'content-type': 'application/json' } },
    )));

    await expect(createCodingSystem({
      systemCode: 'SNOMED-CT',
      systemName: 'SNOMED CT',
      url: 'http://snomed.info/sct',
      active: true,
    })).rejects.toThrow('create system failed: duplicate code system url: http://snomed.info/sct');
  });
});
