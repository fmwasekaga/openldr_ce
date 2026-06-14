import { type Logger, errorMessage, redact } from '@openldr/core';
import type { BlobStoragePort, EventEnvelope } from '@openldr/ports';
import type { Provenance, PersistResult } from '@openldr/db';
import type { ConverterResolver } from './resolver';
import type { BatchStore } from './batch-store';

/** Audit hook — a structural callback so ingest stays decoupled from @openldr/audit. */
export type AuditHook = (e: {
  actorType: 'system';
  actorName: string;
  action: string;
  entityType: string;
  entityId: string;
  metadata?: Record<string, unknown>;
}) => Promise<void>;

export interface HandleDeps {
  blob: BlobStoragePort;
  persist: (resources: unknown[], provenance: Provenance) => Promise<PersistResult[]>;
  resolver: ConverterResolver;
  batches: BatchStore;
  logger: Logger;
  audit?: AuditHook;
  onBatchDone?: (info: { batchId: string; source: string; converter: string; count: number }) => Promise<void>;
}

interface IngestPayload {
  batchId: string;
  blobKey: string;
  source: string;
  converter: string;
  config?: Record<string, string> | null;
}

export async function handleIngestEvent(deps: HandleDeps, event: EventEnvelope): Promise<void> {
  const { batchId, blobKey, source, converter, config } = event.payload as IngestPayload;
  await deps.batches.markProcessing(batchId);
  try {
    const raw = await deps.blob.get(blobKey);
    const c = await deps.resolver.resolve(converter);
    if (!c) throw new Error(`unknown converter: ${converter}`);
    const resources = await c.convert(raw, { source, batchId, config: config ?? undefined });
    const provenance: Provenance = { sourceSystem: source, pluginId: c.id, pluginVersion: c.version, batchId };
    await deps.persist(resources, provenance);
    await deps.batches.markDone(batchId, resources.length);
    deps.logger.info({ batchId, source, converter, count: resources.length }, 'ingest batch persisted');
    await deps.audit?.({
      actorType: 'system',
      actorName: 'system',
      action: 'ingest.batch.done',
      entityType: 'batch',
      entityId: batchId,
      metadata: { source, converter, pluginId: c.id, pluginVersion: c.version, count: resources.length },
    });
    await deps.onBatchDone?.({ batchId, source, converter, count: resources.length });
  } catch (err) {
    const msg = redact(errorMessage(err));
    await deps.batches.markFailed(batchId, msg);
    deps.logger.error({ batchId, error: msg }, 'ingest batch failed');
    await deps.audit?.({
      actorType: 'system',
      actorName: 'system',
      action: 'ingest.batch.failed',
      entityType: 'batch',
      entityId: batchId,
      metadata: { source, converter, error: msg },
    });
    throw err;
  }
}
