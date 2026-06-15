import { describe, it, expect } from 'vitest';
import { publisherSections } from './publisherSections';
import type { Publisher, CodingSystem } from '../api';

const pub = (id: string, name: string, seeded: boolean, sortOrder: number): Publisher => ({ id, name, role: 'standard', icon: null, seeded, sortOrder });
const sys = (id: string, pubId: string): CodingSystem => ({ id, systemCode: id, systemName: id, url: null, systemVersion: null, description: null, active: true, publisherId: pubId, seeded: true });

describe('publisherSections', () => {
  it('keeps publishers with systems or that are not seeded, sorted by sortOrder', () => {
    const pubs = [pub('a', 'A', true, 1), pub('b', 'B (empty seeded)', true, 0), pub('c', 'C (custom empty)', false, 2)];
    const sections = publisherSections(pubs, [sys('s1', 'a')]);
    expect(sections.map((s) => s.publisher.id)).toEqual(['a', 'c']); // b dropped (empty seeded); sorted by sortOrder
    expect(sections[0].systems).toHaveLength(1);
  });
});
