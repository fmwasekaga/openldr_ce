import { detectAdapter } from './adapters/index';
import { INDEX_SCHEMA_VERSION, type IndexWriter, type OntologyBuildProgress, type PanelMember } from './types';

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
): Promise<void> {
  const detected = detectAdapter(sourcePath);
  if (!detected) {
    const err = new Error('No LOINC / SNOMED CT / RxNorm distribution found in that folder.');
    await store.failBuild(systemId, 'unknown', sourcePath, err.message);
    throw err;
  }
  const { adapter, dist } = detected;
  await store.beginBuild(systemId, adapter.type, sourcePath);
  try {
    await store.clearIndex(systemId);
    const writer = new BufferedWriter();
    await adapter.buildIndex(dist, writer, (progress) => onProgress({ ...progress, codingSystemId: systemId }));
    await flushChunked(writer.nodes, (chunk) => store.bulkInsertNodes(systemId, chunk));
    await flushChunked(writer.edges, (chunk) => store.bulkInsertEdges(systemId, chunk));
    await flushChunked(writer.panels, (chunk) => store.bulkInsertPanelMembers(systemId, chunk));
    await flushChunked(writer.answers, (chunk) => store.bulkInsertAnswerOptions(systemId, chunk));
    await flushChunked(writer.specimens, (chunk) => store.bulkInsertSpecimens(systemId, chunk));
    await store.finishBuild(systemId, {
      ontologyType: adapter.type,
      sourcePath,
      nodeCount: writer.nodes.length,
      edgeCount: writer.edges.length,
      manifest: { schemaVersion: INDEX_SCHEMA_VERSION, ontologyType: adapter.type, sourcePath, fileStats: dist.fileStats },
    });
  } catch (err) {
    await store.failBuild(systemId, adapter.type, sourcePath, (err as Error).message);
    throw err;
  }
}
