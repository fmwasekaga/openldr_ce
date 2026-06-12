import { randomUUID } from 'node:crypto';
import type { BlobStoragePort, EventingPort } from '@openldr/ports';
import type { Logger } from '@openldr/core';
import type { BatchStore } from './batch-store';

export interface AcceptInput {
  data: Uint8Array;
  source: string;
  converter: string;
  contentType?: string;
  filename?: string;
}

export interface AcceptDeps {
  blob: BlobStoragePort;
  eventing: EventingPort;
  batches: BatchStore;
  logger: Logger;
}

export async function acceptPayload(deps: AcceptDeps, input: AcceptInput): Promise<{ batchId: string; blobKey: string }> {
  const batchId = randomUUID();
  const blobKey = `ingest/${batchId}/${input.filename ?? 'payload'}`;
  await deps.blob.put(blobKey, input.data, input.contentType);
  await deps.batches.create({ batchId, source: input.source, blobKey, contentType: input.contentType, converter: input.converter });
  await deps.eventing.publish({ type: 'ingest.received', payload: { batchId, blobKey, source: input.source, converter: input.converter } });
  deps.logger.info({ batchId, source: input.source, converter: input.converter }, 'ingest payload accepted');
  return { batchId, blobKey };
}
