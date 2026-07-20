export interface IngestProgress { phase: string; processed: number; total: number | null }

export interface IngestDeps {
  loadConcepts(systemType: string, distDir: string, opts: { acceptLicense: boolean }): Promise<{ conceptsLoaded: number }>;
  buildOntology(systemType: string, codingSystemId: string, distDir: string, onProgress: (p: IngestProgress) => void): Promise<void>;
}

export interface IngestResult { conceptsLoaded: number }

/** Orchestrate a single distribution ingest: flat concepts THEN the ontology tree, over one extracted
 *  dir. Slice 1 supports LOINC only (it has both a term loader and an ontology adapter). */
export async function ingestDistribution(input: {
  systemType: string;
  codingSystemId: string;
  distDir: string;
  acceptLicense: boolean;
  deps: IngestDeps;
  onProgress: (p: IngestProgress) => void;
}): Promise<IngestResult> {
  if (input.systemType !== 'loinc') {
    throw new Error(`unsupported system type: ${input.systemType} (only loinc is supported in this release)`);
  }
  if (!input.acceptLicense) {
    throw new Error('the distribution license must be accepted before import');
  }
  input.onProgress({ phase: 'concepts', processed: 0, total: null });
  const { conceptsLoaded } = await input.deps.loadConcepts(input.systemType, input.distDir, { acceptLicense: input.acceptLicense });
  input.onProgress({ phase: 'concepts', processed: conceptsLoaded, total: conceptsLoaded });
  await input.deps.buildOntology(input.systemType, input.codingSystemId, input.distDir, input.onProgress);
  return { conceptsLoaded };
}
