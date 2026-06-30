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

const typedDeps = {
  connectors: { list: async () => [
    { id: 'a', name: 'PG One', pluginId: null, type: 'postgres' },
    { id: 'b', name: 'MSSQL', pluginId: null, type: 'microsoft-sql' },
    { id: 'c', name: 'DHIS2', pluginId: 'dhis2-sink', type: null },
  ] },
  datasets: { list: async () => [] },
  dhis2Mappings: async () => [],
  forms: { listPublished: async () => [] },
} as unknown as NodeOptionsDeps;

describe('resolveNodeOptions connectors:<type>', () => {
  it('filters connectors by type', async () => {
    expect(await resolveNodeOptions('connectors:postgres', typedDeps)).toEqual([{ value: 'a', label: 'PG One' }]);
    expect(await resolveNodeOptions('connectors:microsoft-sql', typedDeps)).toEqual([{ value: 'b', label: 'MSSQL' }]);
  });
  it('bare connectors lists all when no pluginId scope', async () => {
    expect((await resolveNodeOptions('connectors', typedDeps)).map((o) => o.value)).toEqual(['a', 'b', 'c']);
  });
});
