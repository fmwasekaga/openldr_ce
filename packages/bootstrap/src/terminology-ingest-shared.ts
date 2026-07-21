import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { redact } from '@openldr/core';
import type { BlobStoragePort } from '@openldr/ports';
import type { AuditStore } from '@openldr/audit';
import { deriveSystemCode, resolveSeedPublisherId, type TerminologyAdminStore, type TerminologyIngestJob, type TerminologyIngestJobStore } from '@openldr/db';
import { canonicalSystemUrl, ingestDistribution, type IngestProgress } from '@openldr/terminology';
import { downloadAndExtract } from './terminology-dist-extract';

// Resolve the coding system for a systemType by its loader-backed canonical URL, creating it if
// absent with the SAME values loadLoinc's saveSystem uses (so it is one row, not a duplicate).
// Shared by the upload route and the CLI so both key concepts to exactly one URL per system.
export async function resolveCodingSystemId(
  admin: TerminologyAdminStore,
  systemType: string,
  version: string | null,
): Promise<string> {
  const url = canonicalSystemUrl(systemType);
  if (!url) throw new Error(`unsupported system type: ${systemType}`);
  let cs = await admin.codingSystems.getByUrl(url);
  if (!cs) {
    await admin.codingSystems.upsertByUrl({
      url,
      systemCode: deriveSystemCode(url),
      systemName: deriveSystemCode(url),
      systemVersion: version,
      publisherId: resolveSeedPublisherId(url),
    });
    cs = await admin.codingSystems.getByUrl(url);
  }
  return cs!.id;
}

export interface IngestTerminology {
  loaders: { loinc(dir: string, acceptLicense: boolean): Promise<{ conceptsLoaded: number }> };
  ontology: { build(systemId: string, dir: string, onProgress: (p: IngestProgress) => void): Promise<unknown> };
  ingestOntologyWithConcepts(systemType: string, systemId: string, dir: string, onProgress: (p: IngestProgress) => void): Promise<{ conceptsLoaded: number }>;
}

// The download→extract→ingest closure. Streams the uploaded zip to a fresh scratch dir per job
// (cleaned up unconditionally, including on a mid-extract throw), then hands the extracted dir to
// the orchestrator (flat concepts before the ontology tree). Shared by the worker and the CLI.
export function createRunIngest(opts: {
  blob: Pick<BlobStoragePort, 'getStream'>;
  terminology: IngestTerminology;
  workDirBase: string;
}): (job: TerminologyIngestJob, onProgress: (p: IngestProgress) => void) => Promise<{ conceptsLoaded: number }> {
  return async (job, onProgress) => {
    const workDir = await mkdtemp(join(opts.workDirBase, 'terminology-ingest-'));
    try {
      const { distDir } = await downloadAndExtract(opts.blob, job.blobKey, workDir);
      return await ingestDistribution({
        systemType: job.systemType,
        codingSystemId: job.codingSystemId,
        distDir,
        acceptLicense: true, // acceptance was enforced at upload/enqueue time
        onProgress,
        deps: {
          loadConcepts: async (_systemType, dir, o) => {
            const r = await opts.terminology.loaders.loinc(dir, o.acceptLicense);
            return { conceptsLoaded: r.conceptsLoaded };
          },
          buildOntology: async (_systemType, codingSystemId, dir, onP) => {
            await opts.terminology.ontology.build(codingSystemId, dir, (p) => onP({ phase: p.phase, processed: p.processed, total: p.total }));
          },
          buildOntologyWithConcepts: async (systemType, codingSystemId, dir, onP) =>
            opts.terminology.ingestOntologyWithConcepts(systemType, codingSystemId, dir, onP),
        },
      });
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  };
}

export interface RunIngestJobDeps {
  job: TerminologyIngestJob;
  jobs: Pick<TerminologyIngestJobStore, 'latestReadyForSystem' | 'updateProgress' | 'finish'>;
  blob: Pick<BlobStoragePort, 'delete'>;
  runIngest(job: TerminologyIngestJob, onProgress: (p: IngestProgress) => void): Promise<{ conceptsLoaded: number }>;
  audit: Pick<AuditStore, 'record'>;
  logger: { info(o: unknown, m?: string): void; error(o: unknown, m?: string): void };
  onProgress?: (p: IngestProgress) => void;
}

// Process one claimed/inserted 'running' job to completion: capture the prior retained blob
// (latestReadyForSystem excludes the current still-'running' job), run the ingest, finish
// ready/failed, audit, and drop the prior blob only on success. Behaviour is identical to the
// worker's former inline processJob; it additionally returns a result and forwards progress to an
// optional onProgress so the CLI can print to the terminal.
export async function runIngestJob(deps: RunIngestJobDeps): Promise<{ status: 'ready' | 'failed'; conceptsLoaded: number; error: string | null }> {
  const { job } = deps;
  const prior = await deps.jobs.latestReadyForSystem(job.systemType).catch(() => null);
  try {
    const { conceptsLoaded } = await deps.runIngest(job, (p) => {
      deps.onProgress?.(p);
      void deps.jobs.updateProgress(job.id, p).catch((err) => deps.logger.error({ err, jobId: job.id }, 'ingest progress write failed'));
    });
    await deps.jobs.finish(job.id, 'ready', null);
    await deps.audit.record({
      actorType: 'system', actorName: 'System', action: 'terminology.import.completed',
      entityType: 'coding_system', entityId: job.codingSystemId,
      metadata: { systemType: job.systemType, version: job.version, conceptsLoaded },
    });
    if (prior && prior.status === 'ready' && prior.blobKey && prior.blobKey !== job.blobKey) {
      await deps.blob.delete(prior.blobKey).catch((err) => deps.logger.error({ err, key: prior.blobKey }, 'prior distribution blob delete failed'));
    }
    return { status: 'ready', conceptsLoaded, error: null };
  } catch (err) {
    const msg = redact(err instanceof Error ? err.message : String(err));
    await deps.jobs.finish(job.id, 'failed', msg);
    await deps.audit.record({
      actorType: 'system', actorName: 'System', action: 'terminology.import.failed',
      entityType: 'coding_system', entityId: job.codingSystemId,
      metadata: { systemType: job.systemType, version: job.version, error: msg },
    });
    deps.logger.error({ jobId: job.id, err }, 'terminology ingest failed');
    // The uploaded blob is intentionally retained so the operator can retry.
    return { status: 'failed', conceptsLoaded: 0, error: msg };
  }
}
