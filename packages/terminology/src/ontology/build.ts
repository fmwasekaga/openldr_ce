import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { detectAdapter } from './adapters/index';
import { INDEX_SCHEMA_VERSION, type ConceptSink, type IndexWriter, type OntologyBuildProgress, type OntologyType, type PanelMember } from './types';

// Real distributions often wrap their content in a single top-level folder — e.g. a SNOMED CT RF2
// release zips everything under `SnomedCT_..._<timestamp>/`, so the `Snapshot/Terminology` files an
// adapter looks for sit one level below the extracted root. When no adapter detects a distribution
// at `dir`, descend through single-subdirectory wrappers (a few levels, defensively) before giving
// up. A folder with the content at its top (multiple entries, e.g. LoincTable/ + AccessoryFiles/)
// detects immediately and never descends.
export function resolveDistributionRoot(dir: string): string {
  let root = dir;
  for (let depth = 0; depth < 4; depth++) {
    if (detectAdapter(root)) return root;
    let subdirs: string[];
    try {
      subdirs = readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
    } catch { break; }
    if (subdirs.length !== 1) break;
    root = join(root, subdirs[0]);
  }
  return root;
}

export interface NodeRow {
  code: string;
  display: string;
  kind: string | null;
  extra: Record<string, unknown> | null;
}

export interface EdgeRow {
  parent: string;
  child: string;
  seq: number;
  label: string | null;
}

export interface AnswerRow {
  loinc: string;
  seq: number;
  value: string;
  label: string;
}

export interface SpecimenRow {
  loinc: string;
  snomedCode: string;
  equivalence: string;
}

export interface OntologyIndexStore {
  beginBuild(systemId: string, ontologyType: string, sourcePath: string): Promise<void>;
  clearIndex(systemId: string): Promise<void>;
  bulkInsertNodes(systemId: string, rows: NodeRow[]): Promise<void>;
  bulkInsertEdges(systemId: string, rows: EdgeRow[]): Promise<void>;
  bulkInsertPanelMembers(systemId: string, rows: PanelMember[]): Promise<void>;
  bulkInsertAnswerOptions(systemId: string, rows: AnswerRow[]): Promise<void>;
  bulkInsertSpecimens(systemId: string, rows: SpecimenRow[]): Promise<void>;
  finishBuild(
    systemId: string,
    opts: { ontologyType: string; sourcePath: string; nodeCount: number; edgeCount: number; manifest: unknown },
  ): Promise<void>;
  failBuild(systemId: string, ontologyType: string, sourcePath: string, error: string): Promise<void>;
}

class BufferedWriter implements IndexWriter {
  nodes: NodeRow[] = [];
  edges: EdgeRow[] = [];
  panels: PanelMember[] = [];
  answers: AnswerRow[] = [];
  specimens: SpecimenRow[] = [];

  insertNode(node: NodeRow): void {
    this.nodes.push(node);
  }

  insertEdge(parent: string, child: string, seq: number, label: string | null = null): void {
    this.edges.push({ parent, child, seq, label });
  }

  insertPanelMember(member: PanelMember): void {
    this.panels.push(member);
  }

  insertAnswerOption(answer: AnswerRow): void {
    this.answers.push(answer);
  }

  insertSpecimenMap(map: SpecimenRow): void {
    this.specimens.push(map);
  }
}

const CHUNK = 5000;

async function flushChunked<T>(rows: T[], fn: (chunk: T[]) => Promise<void>): Promise<void> {
  for (let i = 0; i < rows.length; i += CHUNK) await fn(rows.slice(i, i + CHUNK));
}

export async function buildOntologyDistribution(
  systemId: string,
  sourcePath: string,
  store: OntologyIndexStore,
  onProgress: (progress: OntologyBuildProgress) => void,
  opts?: { conceptSink?: ConceptSink; expectedType?: OntologyType },
): Promise<void> {
  // Unwrap a single top-level release folder (e.g. SNOMED RF2) so detection finds the content.
  const root = resolveDistributionRoot(sourcePath);
  const detected = detectAdapter(root);
  if (!detected) {
    const err = new Error('No LOINC / SNOMED CT / RxNorm distribution found in that folder.');
    await store.failBuild(systemId, 'unknown', root, err.message);
    throw err;
  }
  const { adapter, dist } = detected;
  if (opts?.expectedType && adapter.type !== opts.expectedType) {
    const err = new Error(`distribution is a ${adapter.type} distribution but ${opts.expectedType} was expected`);
    await store.failBuild(systemId, adapter.type, root, err.message);
    throw err;
  }
  await store.beginBuild(systemId, adapter.type, root);
  try {
    await store.clearIndex(systemId);
    const writer = new BufferedWriter();
    await adapter.buildIndex(dist, writer, (progress) => onProgress({ ...progress, codingSystemId: systemId }), opts?.conceptSink);
    await flushChunked(writer.nodes, (chunk) => store.bulkInsertNodes(systemId, chunk));
    await flushChunked(writer.edges, (chunk) => store.bulkInsertEdges(systemId, chunk));
    await flushChunked(writer.panels, (chunk) => store.bulkInsertPanelMembers(systemId, chunk));
    await flushChunked(writer.answers, (chunk) => store.bulkInsertAnswerOptions(systemId, chunk));
    await flushChunked(writer.specimens, (chunk) => store.bulkInsertSpecimens(systemId, chunk));
    await store.finishBuild(systemId, {
      ontologyType: adapter.type,
      sourcePath: root,
      nodeCount: writer.nodes.length,
      edgeCount: writer.edges.length,
      manifest: { schemaVersion: INDEX_SCHEMA_VERSION, ontologyType: adapter.type, sourcePath: root, fileStats: dist.fileStats },
    });
  } catch (err) {
    await store.failBuild(systemId, adapter.type, root, (err as Error).message);
    throw err;
  }
}
