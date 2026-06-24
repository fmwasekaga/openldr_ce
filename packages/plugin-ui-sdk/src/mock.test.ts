import { describe, it, expect } from 'vitest';
import { createMockOpenldr } from './mock';

describe('createMockOpenldr', () => {
  it('round-trips storage in-memory and resolves ready', async () => {
    const api = createMockOpenldr({ pluginId: 'p1', capabilities: ['host:reports'] });
    await api.ready;
    await api.storage.put('c', 'k', { n: 1 });
    expect(await api.storage.get('c', 'k')).toEqual({ n: 1 });
    const list = await api.storage.list('c');
    expect(list).toEqual([{ collection: 'c', key: 'k', doc: { n: 1 } }]);
  });
  it('reports.list returns the seeded fixture', async () => {
    const api = createMockOpenldr({ pluginId: 'p1', capabilities: ['host:reports'], reports: [{ id: 'r1' }] });
    expect(await api.reports.list()).toEqual([{ id: 'r1' }]);
  });
});
