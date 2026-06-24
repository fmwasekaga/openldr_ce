import { describe, it, expect } from 'vitest';
import { parseIndex, mergeIndexEntry, type MarketplaceIndexEntry } from './index-json';

const entry = (over: Partial<MarketplaceIndexEntry> = {}): MarketplaceIndexEntry => ({
  id: 'whonet-sqlite', kind: 'plugin', latestVersion: '1.1.0',
  publisher: 'OpenLDR', summary: 'WHONET -> FHIR', readme: '',
  path: 'bundles/whonet-sqlite-1.1.0', signatureFingerprint: 'a'.repeat(64), ...over,
});

describe('index-json', () => {
  it('parses a valid index', () => {
    const idx = parseIndex({ schemaVersion: 1, name: 'M', updatedAt: '2026-01-01T00:00:00Z', packages: [entry()] });
    expect(idx.packages).toHaveLength(1);
    expect(idx.packages[0].id).toBe('whonet-sqlite');
  });

  it('rejects malformed input', () => {
    expect(() => parseIndex({ schemaVersion: 1, packages: 'nope' })).toThrow();
  });

  it('appends a new entry and bumps updatedAt', () => {
    const idx = parseIndex({ schemaVersion: 1, name: 'M', updatedAt: 'old', packages: [] });
    const next = mergeIndexEntry(idx, entry(), '2026-06-23T00:00:00Z');
    expect(next.packages).toHaveLength(1);
    expect(next.updatedAt).toBe('2026-06-23T00:00:00Z');
  });

  it('updates an existing entry by id (no duplicate)', () => {
    const idx = parseIndex({ schemaVersion: 1, name: 'M', updatedAt: 'old', packages: [entry({ latestVersion: '1.0.0' })] });
    const next = mergeIndexEntry(idx, entry({ latestVersion: '1.1.0' }), 'now');
    expect(next.packages).toHaveLength(1);
    expect(next.packages[0].latestVersion).toBe('1.1.0');
  });

  it('seeds an empty index from scratch', () => {
    const seeded = mergeIndexEntry(parseIndex(null), entry(), 'now');
    expect(seeded.packages).toHaveLength(1);
    expect(seeded.schemaVersion).toBe(1);
  });
});
