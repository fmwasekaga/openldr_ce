import { describe, it, expect } from 'vitest';
import { HOST_NODE_DESCRIPTORS } from './host-nodes';

describe('HOST_NODE_DESCRIPTORS', () => {
  it('describes the built-in nodes uniformly as host descriptors', () => {
    expect(HOST_NODE_DESCRIPTORS.length).toBeGreaterThan(0);
    for (const d of HOST_NODE_DESCRIPTORS) {
      expect(d.source).toBe('host');
      expect(d.pluginId).toBeUndefined();
      expect(['source', 'transform', 'sink']).toContain(d.kind);
      expect(typeof d.id).toBe('string');
      // source nodes must declare no inputs (the registry invariant)
      if (d.kind === 'source') expect(d.ports.inputs).toEqual([]);
    }
  });

  it('has unique ids', () => {
    const ids = HOST_NODE_DESCRIPTORS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
