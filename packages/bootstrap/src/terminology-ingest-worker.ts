import type { BlobStoragePort } from '@openldr/ports';
import type { TerminologyIngestJob, TerminologyIngestJobStore } from '@openldr/db';
import type { AuditStore } from '@openldr/audit';
import type { IngestProgress } from '@openldr/terminology';
import { runIngestJob } from './terminology-ingest-shared';

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
    await runIngestJob({
      job, jobs: deps.jobs, blob: deps.blob, runIngest: deps.runIngest,
      audit: deps.audit, logger: deps.logger,
    });
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

  // Crash recovery: any job still 'running' at startup is orphaned (single worker), so fail it.
  // Best-effort and non-blocking — a failure here must never prevent the worker from starting. The
  // handle is retained so stop() can await it (the .catch means it never rejects), preventing a
  // stray recovery log from firing after shutdown.
  const crashRecovery = deps.jobs.failStaleRunning('interrupted — the server restarted before the import finished')
    .then((n) => { if (n > 0) deps.logger.info({ count: n }, 'reset orphaned terminology ingest jobs at startup'); })
    .catch((err) => deps.logger.error({ err }, 'terminology ingest crash-recovery failed'));

  const timer = setInterval(() => { if (!stopped) void tickOnce(); }, intervalMs);

  return {
    tickOnce,
    async stop() { stopped = true; clearInterval(timer); await crashRecovery; },
  };
}
