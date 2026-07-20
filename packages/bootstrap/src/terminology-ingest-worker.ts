import { redact } from '@openldr/core';
import type { BlobStoragePort } from '@openldr/ports';
import type { TerminologyIngestJob, TerminologyIngestJobStore } from '@openldr/db';
import type { AuditStore } from '@openldr/audit';
import type { IngestProgress } from '@openldr/terminology';

export interface TerminologyIngestWorkerDeps {
  jobs: TerminologyIngestJobStore;
  blob: Pick<BlobStoragePort, 'getStream' | 'delete'>;
  runIngest(job: TerminologyIngestJob, onProgress: (p: IngestProgress) => void): Promise<{ conceptsLoaded: number }>;
  audit: Pick<AuditStore, 'record'>;
  workDirBase: string;
  intervalMs?: number;
  logger: { info(o: unknown, m?: string): void; error(o: unknown, m?: string): void };
}

export interface TerminologyIngestWorker {
  tickOnce(): Promise<void>;
  stop(): Promise<void>;
}

export function createTerminologyIngestWorker(deps: TerminologyIngestWorkerDeps): TerminologyIngestWorker {
  const intervalMs = deps.intervalMs ?? 3000;
  let stopped = false;
  let running = false;

  async function processJob(job: TerminologyIngestJob): Promise<void> {
    // Capture the prior retained blob BEFORE finishing, so we can delete it only on success.
    // Use latestReadyForSystem (not latestForSystem) so this naturally excludes the current job
    // itself — which is still 'running' at this point, not 'ready' — instead of relying on the
    // status guard below to filter it out after the fact.
    const prior = await deps.jobs.latestReadyForSystem(job.systemType).catch(() => null);
    try {
      const { conceptsLoaded } = await deps.runIngest(job, (p) => {
        void deps.jobs.updateProgress(job.id, p).catch((err) => deps.logger.error({ err, jobId: job.id }, 'ingest progress write failed'));
      });
      await deps.jobs.finish(job.id, 'ready', null);
      await deps.audit.record({
        actorType: 'system', actorName: 'System', action: 'terminology.import.completed',
        entityType: 'coding_system', entityId: job.codingSystemId,
        metadata: { systemType: job.systemType, version: job.version, conceptsLoaded },
      });
      // Retain only the latest zip: drop the previous ready job's blob if it differs.
      if (prior && prior.status === 'ready' && prior.blobKey && prior.blobKey !== job.blobKey) {
        await deps.blob.delete(prior.blobKey).catch((err) => deps.logger.error({ err, key: prior.blobKey }, 'prior distribution blob delete failed'));
      }
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
    }
  }

  async function tickOnce(): Promise<void> {
    if (running) return;
    running = true;
    try {
      const job = await deps.jobs.claimNext();
      if (job) await processJob(job);
    } catch (err) {
      deps.logger.error({ err }, 'terminology ingest tick failed');
    } finally {
      running = false;
    }
  }

  const timer = setInterval(() => { if (!stopped) void tickOnce(); }, intervalMs);

  return {
    tickOnce,
    async stop() { stopped = true; clearInterval(timer); },
  };
}
