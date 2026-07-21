import type { ConceptRecord } from '@openldr/db';

export type OntologyType = 'loinc' | 'snomed' | 'rxnorm';
export type OntologyIndexStatus = 'none' | 'building' | 'ready' | 'stale' | 'error';

export type ConceptSink = (rows: ConceptRecord[]) => Promise<void>;

export interface OntologyNode {
  code: string;
  display: string;
  kind: string;
  extra: Record<string, unknown> | null;
  childCount: number;
  group: string | null;
}

export interface OntologyBreadcrumb {
  code: string;
  display: string;
}

export interface OntologyDistribution {
  codingSystemId: string;
  ontologyType: OntologyType;
  sourcePath: string;
  indexStatus: OntologyIndexStatus;
  indexError: string | null;
  nodeCount: number | null;
  edgeCount: number | null;
  builtAt: string | null;
  updatedAt: string;
}

export interface OntologyBuildProgress {
  codingSystemId: string;
  phase: string;
  processed: number;
  total: number | null;
}

export interface PanelMember {
  panelLoinc: string;
  memberLoinc: string;
  memberName: string;
  displayName: string;
  sequence: number;
  required: boolean;
}

export interface SpecimenCode {
  snomedCode: string;
  equivalence: string;
}

export interface AnswerOption {
  value: string;
  label: string;
}

export interface FileStat {
  path: string;
  size: number;
  mtimeMs: number;
}

export interface DetectedDistribution {
  type: OntologyType;
  folderPath: string;
  files: Record<string, string>;
  fileStats: FileStat[];
}

export interface IndexWriter {
  insertNode(node: { code: string; display: string; kind: string | null; extra: Record<string, unknown> | null }): void;
  insertEdge(parent: string, child: string, seq: number, label?: string | null): void;
  insertPanelMember(member: PanelMember): void;
  insertAnswerOption(answer: { loinc: string; seq: number; value: string; label: string }): void;
  insertSpecimenMap(map: { loinc: string; snomedCode: string; equivalence: string }): void;
}

export interface OntologyAdapter {
  type: OntologyType;
  detect(folderPath: string): DetectedDistribution | null;
  buildIndex(
    dist: DetectedDistribution,
    writer: IndexWriter,
    onProgress: (progress: Omit<OntologyBuildProgress, 'codingSystemId'>) => void,
    conceptSink?: ConceptSink,
  ): void | Promise<void>;
}

export const ROOT_CODE = '__ROOT__';
export const INDEX_SCHEMA_VERSION = 1;
