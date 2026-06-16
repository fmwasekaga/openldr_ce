import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { INDEX_SCHEMA_VERSION, type FileStat } from './types';
import { stalenessReason, type OntologyManifest } from './staleness';

function manifest(fileStats: FileStat[]): OntologyManifest {
  return {
    schemaVersion: INDEX_SCHEMA_VERSION,
    ontologyType: 'loinc',
    sourcePath: 'fixture',
    fileStats,
  };
}

describe('stalenessReason', () => {
  it('compares schema version and source file stats', () => {
    const dir = mkdtempSync(join(tmpdir(), 'openldr-ontology-'));
    try {
      const file = join(dir, 'source.csv');
      writeFileSync(file, 'alpha');
      const st = statSync(file);
      const stats = [{ path: file, size: st.size, mtimeMs: st.mtimeMs }];

      expect(stalenessReason(manifest(stats))).toBeNull();
      expect(stalenessReason({ ...manifest(stats), schemaVersion: INDEX_SCHEMA_VERSION + 1 })).toBe('schema');

      writeFileSync(file, 'alpha beta');
      expect(stalenessReason(manifest(stats))).toBe('files');

      expect(stalenessReason(manifest([{ path: join(dir, 'missing.csv'), size: 1, mtimeMs: 1 }]))).toBe('files');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
