import { describe, it, expect } from 'vitest';
import { resolveNodeOptions, type NodeOptionsDeps } from './workflows-node-options';

const deps = (): NodeOptionsDeps => ({
  connectors: { list: async () => [] },
  datasets: { list: async () => [] },
  dhis2Mappings: async () => [],
  forms: { listPublished: async () => [{ id: 'form-1', name: 'AMR Result' }, { id: 'form-2', name: 'TB Result' }] },
});

describe('resolveNodeOptions forms', () => {
  it('maps published forms to {value,label}', async () => {
    const out = await resolveNodeOptions('forms', deps());
    expect(out).toEqual([
      { value: 'form-1', label: 'AMR Result' },
      { value: 'form-2', label: 'TB Result' },
    ]);
  });

  it('returns [] for an unknown source', async () => {
    expect(await resolveNodeOptions('nope', deps())).toEqual([]);
  });
});
