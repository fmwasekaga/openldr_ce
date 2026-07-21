export interface IngestProgress { phase: string; processed: number; total: number | null }

export interface IngestDeps {
  loadConcepts(systemType: string, distDir: string, opts: { acceptLicense: boolean }): Promise<{ conceptsLoaded: number }>;
  buildOntology(systemType: string, codingSystemId: string, distDir: string, onProgress: (p: IngestProgress) => void): Promise<void>;
  buildOntologyWithConcepts(systemType: string, codingSystemId: string, distDir: string, onProgress: (p: IngestProgress) => void): Promise<{ conceptsLoaded: number }>;
}

export interface IngestResult { conceptsLoaded: number }

const SUPPORTED = new Set(['loinc', 'snomed', 'rxnorm']);

/** Orchestrate a single distribution ingest into flat concepts + the ontology tree, over one extracted
 *  dir. LOINC reads its concepts from a separate file (loadConcepts) then builds the tree; SNOMED/RxNorm
 *  read concepts and tree from the SAME file, so they are teed in one parse (buildOntologyWithConcepts). */
export async function ingestDistribution(input: {
  systemType: string;
  codingSystemId: string;
  distDir: string;
  acceptLicense: boolean;
  deps: IngestDeps;
  onProgress: (p: IngestProgress) => void;
}): Promise<IngestResult> {
  if (!SUPPORTED.has(input.systemType)) {
    throw new Error(`unsupported system type: ${input.systemType}`);
  }
  if (!input.acceptLicense) {
    throw new Error('the distribution license must be accepted before import');
  }
  if (input.systemType === 'loinc') {
    input.onProgress({ phase: 'concepts', processed: 0, total: null });
    const { conceptsLoaded } = await input.deps.loadConcepts(input.systemType, input.distDir, { acceptLicense: input.acceptLicense });
    input.onProgress({ phase: 'concepts', processed: conceptsLoaded, total: conceptsLoaded });
    await input.deps.buildOntology(input.systemType, input.codingSystemId, input.distDir, input.onProgress);
    return { conceptsLoaded };
  }
  // snomed / rxnorm: concepts + tree from one parse.
  const { conceptsLoaded } = await input.deps.buildOntologyWithConcepts(input.systemType, input.codingSystemId, input.distDir, input.onProgress);
  return { conceptsLoaded };
}
