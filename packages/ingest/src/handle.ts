import { type Logger, errorMessage, redact } from '@openldr/core';
import type { BlobStoragePort, EventEnvelope } from '@openldr/ports';
import type { Provenance, PersistResult } from '@openldr/db';
import type { ConverterRegistry } from './converter';
import type { BatchStore } from './batch-store';

export interface HandleDeps {
  blob: BlobStoragePort;
  persist: (resource: unknown, provenance: Provenance) => Promise<PersistResult>;
  converters: ConverterRegistry;
  batches: BatchStore;
  logger: Logger;
}

interface IngestPayload {
  batchId: string;
  blobKey: string;
  source: string;
  converter: string;
}

export async function handleIngestEvent(deps: HandleDeps, event: EventEnvelope): Promise<void> {
  const { batchId, blobKey, source, converter } = event.payload as IngestPayload;
  await deps.batches.markProcessing(batchId);
  try {
    const raw = await deps.blob.get(blobKey);
    const c = deps.converters.get(converter);
    if (!c) throw new Error(`unknown converter: ${converter}`);
    const resources = await c.convert(raw, { source, batchId });
    const provenance: Provenance = { sourceSystem: source, pluginId: c.id, pluginVersion: c.version, batchId };
    for (const resource of resources) {
      await deps.persist(resource, provenance);
    }
    await deps.batches.markDone(batchId, resources.length);
    deps.logger.info({ batchId, source, converter, count: resources.length }, 'ingest batch persisted');
  } catch (err) {
    const msg = redact(errorMessage(err));
    await deps.batches.markFailed(batchId, msg);
    deps.logger.error({ batchId, error: msg }, 'ingest batch failed');
    throw err;
  }
}
