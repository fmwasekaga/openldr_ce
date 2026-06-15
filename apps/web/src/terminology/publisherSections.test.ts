import { describe, it, expect } from 'vitest';
import { publisherSections } from './publisherSections';
import type { Publisher, CodingSystem } from '../api';

const pub = (id: string, name: string, seeded: boolean, sortOrder: number): Publisher => ({ id, name, role: 'standard', icon: null, seeded, sortOrder });
const sys = (id: string, pubId: string): CodingSystem => ({ id, systemCode: id, systemName: id, url: null, systemVersion: null, description: null, active: true, publisherId: pubId, seeded: true });

describe('publisherSections', () => {
  it('returns ALL publishers sorted by sortOrder (seeded always visible, empty custom included)', () => {
    // a: seeded, sortOrder 1, has a system
    // b: seeded, sortOrder 0, empty — must still appear (non-deletable standard)
    // c: custom (non-seeded), sortOrder 2, empty — must appear (just-created stays visible)
    const pubs = [pub('a', 'A', true, 1), pub('b', 'B (empty seeded)', true, 0), pub('c', 'C (custom empty)', false, 2)];
    const sections = publisherSections(pubs, [sys('s1', 'a')]);
    // Sorted by sortOrder: b(0) → a(1) → c(2); nothing is dropped
    expect(sections.map((s) => s.publisher.id)).toEqual(['b', 'a', 'c']);
    expect(sections.find((s) => s.publisher.id === 'a')!.systems).toHaveLength(1);
    expect(sections.find((s) => s.publisher.id === 'b')!.systems).toHaveLength(0);
    expect(sections.find((s) => s.publisher.id === 'c')!.systems).toHaveLength(0);
  });
});
