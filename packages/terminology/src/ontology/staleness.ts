import { statSync } from 'node:fs';
import { INDEX_SCHEMA_VERSION, type FileStat } from './types';

export interface OntologyManifest {
  schemaVersion: number;
  ontologyType: string;
  sourcePath: string;
  fileStats: FileStat[];
}

export function stalenessReason(manifest: OntologyManifest | null | undefined): 'schema' | 'files' | null {
  if (!manifest) return null;
  if (manifest.schemaVersion !== INDEX_SCHEMA_VERSION) return 'schema';
  if (!manifest.fileStats || manifest.fileStats.length === 0) return 'files';
  for (const file of manifest.fileStats) {
    try {
      const st = statSync(file.path);
      if (st.size !== file.size || Math.abs(st.mtimeMs - file.mtimeMs) > 1) return 'files';
    } catch {
      return 'files';
    }
  }
  return null;
}

export function isStale(manifest: OntologyManifest | null | undefined): boolean {
  return stalenessReason(manifest) !== null;
}
